/**
 * HybridRouter — clasifica `user:message` en tier `local` o `cloud`.
 *
 * Algoritmo (ver [ADR 0015](../../../../../docs/adr/0015-hybrid-router-classifier-llm-based.md)
 * y [ADR 0022 §5](../../../../../docs/adr/0022-shiro-agentic-tools-fs-shell.md)):
 *
 *   0. **Pre-decisión tool-required**: si la query pide claramente una
 *      acción sobre el sistema (leer/escribir archivos, ejecutar comandos),
 *      fuerza `cloud` **sin** consultar al clasificador. El slot local
 *      (qwen 2.5 3b) no hace tool-use fiable, así que cualquier turno que
 *      vaya a necesitar tools tiene que ir a Claude. Determinista y barato.
 *   1. Pregunta a Ollama con `format: { tier, requires_tools }`
 *      (clasificador LLM, prompt corto, temperatura baja). Si el modelo
 *      marca `requires_tools`, se fuerza `cloud` aunque el `tier` sea local.
 *   2. Race con timeout de 2s.
 *   3. Si algo falla (timeout, fetch, parse, malformed) → heurística
 *      determinista basada en tool-markers + longitud + keywords de
 *      razonamiento complejo.
 *
 * Privacy-first: el default del fallback es `'local'`. Si todo falla,
 * el mensaje se queda en el modelo local (Ollama) y no se manda a cloud
 * sin querer.
 *
 * **Hito futuro** (ADR 0022 §5): cuando exista un modelo local con tool-use
 * fiable (qwen3-coder + 5080), el router ganará `local.can_do_tools`; hoy es
 * `false` siempre, así que tool-required ⇒ cloud.
 *
 * Browser-safe: usa `fetch` global. El cliente raramente lo necesita
 * (el router corre server-side por ADR 0012), pero queda en core para
 * estar disponible.
 */

import { z } from 'zod';
import type { LLMRequest } from '../../interfaces/ILLMModule.js';
import type { IRouterModule, LLMTier } from '../../interfaces/IRouterModule.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const HybridRouterConfigSchema = z.object({
  /** Modelo Ollama usado como clasificador. Default `qwen2.5:3b`. */
  classifier_model: z.string().min(1).default('qwen2.5:3b'),
  /** Host del servidor Ollama. Default `http://localhost:11434`. */
  classifier_host: z.string().url().default('http://localhost:11434'),
  /**
   * Timeout total del clasificador en ms. Default 2s. Si Ollama tarda
   * más (cold load), caemos al fallback heurístico.
   */
  timeout_ms: z.number().int().positive().default(2_000),
  /**
   * **Deprecated en V1.** Asumía clasificación con score 0-1 con
   * threshold de corte; V1 usa clasificación binaria, así que el
   * campo se ignora pero se acepta en el schema para no romper YAMLs
   * existentes. Ver ADR 0015.
   */
  cloud_threshold: z.number().optional(),
});

export type HybridRouterConfig = z.infer<typeof HybridRouterConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class HybridRouterError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HybridRouterError';
  }
}

// ─── Heurística (también exportada para tests) ────────────────────────

// Verbos de razonamiento complejo. Usamos raíces (no la forma completa)
// para capturar conjugaciones: "explica", "explícame", "explicar", etc.
// Las variantes con acento (`í`, `ñ`) se cubren con clases de caracteres.
const COMPLEX_MARKERS =
  /\b(expl[ií]c|explain|analiz|analyz|compar|dise[ñn]|design|program|implement|optimiz|debug|estrateg|strategy)/i;

const LONG_TEXT_THRESHOLD = 200;

/**
 * Marcadores de que la query probablemente necesita **ejecutar una tool**
 * (filesystem o shell, ADR 0022 §5): vocabulario de archivos/rutas/comandos
 * y verbos de ejecución. Deliberadamente conservador para no mandar charla
 * casual a cloud — los casos sutiles ("verifica que el build pase") los
 * recoge el clasificador LLM vía `requires_tools`.
 *
 * Incluye también los gatillos de **self-dev** (ADR 0023): pedirle a Shiro que
 * proponga un PR / mejore su propio código dispara el loop tool-use
 * (`selfdev:propose`), que solo el slot cloud ejecuta. Sin estos markers, con el
 * clasificador caído el turno cae a local y self-dev nunca arranca.
 */
const TOOL_MARKERS =
  /(\b(archivo|fichero|carpeta|directorio|file|folder|directory|ruta|path|terminal|shell|comando|command|ejecut\w*|git|commit|repositorio|repo|selfdev)\b|\bself-dev\b|\bpull request\b|\bPR\b|\.(txt|md|json|ts|js|py|csv|log)\b)/i;

/**
 * `true` si la query pide claramente una acción sobre el sistema que
 * requeriría tool-use. Determinista; usado como fast-path en `route` y como
 * regla del fallback heurístico. Ver ADR 0022 §5.
 */
export function requiresToolsByHeuristic(text: string): boolean {
  return TOOL_MARKERS.test(text);
}

/**
 * Heurística determinista para clasificar un mensaje. Útil como
 * fallback cuando el clasificador LLM no está disponible, y como
 * referencia testeable aislada.
 *
 * Reglas:
 * - Pide una acción sobre el sistema (tool-markers) → 'cloud' (ADR 0022 §5).
 * - Texto > 200 caracteres → 'cloud'.
 * - Contiene verbos de razonamiento complejo → 'cloud'.
 * - En cualquier otro caso → 'local' (privacy-first).
 */
export function routeByHeuristic(text: string): LLMTier {
  if (requiresToolsByHeuristic(text)) return 'cloud';
  if (text.length > LONG_TEXT_THRESHOLD) return 'cloud';
  if (COMPLEX_MARKERS.test(text)) return 'cloud';
  return 'local';
}

// ─── Schema del response del clasificador ─────────────────────────────

const ClassifierResponseSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
});

const ClassifierPayloadSchema = z.object({
  tier: z.union([z.literal('local'), z.literal('cloud')]),
  /**
   * `true` si el mensaje pide una acción sobre el sistema (leer/escribir
   * archivos, ejecutar comandos) que necesitaría tool-use. Opcional con
   * default `false` para tolerar modelos que omitan el campo. Ver ADR 0022 §5.
   */
  requires_tools: z.boolean().optional().default(false),
});

const CLASSIFIER_SYSTEM_PROMPT = [
  'Clasificas mensajes de usuario para enrutarlos a un LLM.',
  'Devuelves dos campos:',
  '- "tier": "local" para saludos, charla casual y preguntas factuales',
  '  simples; "cloud" para razonamiento complejo, código o análisis largo.',
  '- "requires_tools": true si el mensaje pide ACTUAR sobre el sistema del',
  '  usuario (leer/escribir/borrar archivos, listar carpetas, ejecutar',
  '  comandos o git) o PROPONER cambios al propio código de Shiro / abrir un',
  '  PR (self-dev); false si solo requiere conversar o razonar.',
  'Respondes SOLO con el JSON requerido.',
].join('\n');

function buildClassifierSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      tier: { type: 'string', enum: ['local', 'cloud'] },
      requires_tools: { type: 'boolean' },
    },
    required: ['tier', 'requires_tools'],
  };
}

// ─── Implementación ───────────────────────────────────────────────────

export class HybridRouter implements IRouterModule {
  readonly id = 'router:hybrid';
  private readonly config: HybridRouterConfig;
  private readonly logger: Logger;

  constructor(rawConfig: unknown, deps: ModuleDeps) {
    const result = HybridRouterConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      throw new HybridRouterError(
        `HybridRouter: config inválida — ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    this.config = result.data;
    this.logger = deps.logger.child({ module: 'HybridRouter' });
  }

  async route(request: LLMRequest): Promise<LLMTier> {
    // 0. Fast-path determinista: si la query pide claramente una acción
    //    sobre el sistema, va a cloud sin consultar al clasificador (el
    //    local no hace tool-use fiable). Ver ADR 0022 §5.
    if (requiresToolsByHeuristic(request.text)) {
      this.logger.debug('query requiere tools (heurística) → forzando cloud');
      return 'cloud';
    }
    try {
      const { tier, requiresTools } = await this.askClassifier(request.text);
      if (requiresTools) {
        this.logger.debug('clasificador marcó requires_tools → forzando cloud');
        return 'cloud';
      }
      return tier;
    } catch (err) {
      this.logger.warn(`clasificador no disponible, usando heurística`, { err });
      return routeByHeuristic(request.text);
    }
  }

  private async askClassifier(text: string): Promise<{ tier: LLMTier; requiresTools: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeout_ms);

    let response: Response;
    try {
      response = await fetch(`${this.config.classifier_host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.classifier_model,
          messages: [
            { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          format: buildClassifierSchema(),
          stream: false,
          options: { temperature: 0.1 },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new HybridRouterError(`clasificador devolvió HTTP ${response.status}`);
    }

    const raw: unknown = await response.json();
    const parsed = ClassifierResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HybridRouterError('respuesta del clasificador con shape inválido');
    }

    const payloadParsed: unknown = JSON.parse(parsed.data.message.content);
    const payload = ClassifierPayloadSchema.safeParse(payloadParsed);
    if (!payload.success) {
      throw new HybridRouterError('payload del clasificador con shape inválido');
    }

    return { tier: payload.data.tier, requiresTools: payload.data.requires_tools };
  }
}
