/**
 * HybridRouter — clasifica `user:message` en tier `local` o `cloud`.
 *
 * Algoritmo (ver [ADR 0015](../../../../../docs/adr/0015-hybrid-router-classifier-llm-based.md)):
 *
 *   1. Pregunta a Ollama con `format: { tier: 'local'|'cloud' }`
 *      (clasificador LLM, prompt corto, temperatura baja).
 *   2. Race con timeout de 2s.
 *   3. Si algo falla (timeout, fetch, parse, malformed) → heurística
 *      determinista basada en longitud + keywords de razonamiento complejo.
 *
 * Privacy-first: el default del fallback es `'local'`. Si todo falla,
 * el mensaje se queda en el modelo local (Ollama) y no se manda a cloud
 * sin querer.
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
 * Heurística determinista para clasificar un mensaje. Útil como
 * fallback cuando el clasificador LLM no está disponible, y como
 * referencia testeable aislada.
 *
 * Reglas:
 * - Texto > 200 caracteres → 'cloud'.
 * - Contiene verbos de razonamiento complejo → 'cloud'.
 * - En cualquier otro caso → 'local' (privacy-first).
 */
export function routeByHeuristic(text: string): LLMTier {
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
});

const CLASSIFIER_SYSTEM_PROMPT = [
  'Clasificas mensajes de usuario en "local" o "cloud".',
  '- "local": saludos, charla casual, preguntas factuales simples.',
  '- "cloud": razonamiento complejo, código, análisis técnico largo.',
  'Respondes SOLO con el JSON requerido.',
].join('\n');

function buildClassifierSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      tier: { type: 'string', enum: ['local', 'cloud'] },
    },
    required: ['tier'],
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
    try {
      const tier = await this.askClassifier(request.text);
      return tier;
    } catch (err) {
      this.logger.warn(`clasificador no disponible, usando heurística`, { err });
      return routeByHeuristic(request.text);
    }
  }

  private async askClassifier(text: string): Promise<LLMTier> {
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

    return payload.data.tier;
  }
}
