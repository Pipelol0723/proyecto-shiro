/**
 * OllamaLLM — cliente del servidor Ollama local (`localhost:11434` por
 * defecto). Implementa `ILLMModule` con respuestas en una sola pasada.
 *
 * Decisiones clave (ADR 0014 ya las recoge en parte; el resto las
 * documentamos aquí porque son específicas de Ollama):
 *
 * 1. **Structured outputs con JSON schema** — Ollama 0.5+ permite pasar
 *    un schema al campo `format` que el modelo está obligado a
 *    satisfacer. Pedimos `{ text: string, emotion: <enum> }` para que
 *    el avatar y el TTS reciban siempre una emoción reconocida.
 *
 * 2. **Fallback `neutral`** — si por la razón que sea el modelo emite
 *    JSON malformado, una emoción desconocida, o el endpoint devuelve
 *    algo raro, devolvemos `emotion: 'neutral'` y dejamos pasar el
 *    texto crudo. Mejor degradar que romper el turno.
 *
 * 3. **Sin `generateStream` (todavía)** — el streaming nativo de Ollama
 *    emite chunks de la JSON serializada, lo que no es útil hasta que
 *    TTS exista y necesitemos chunks de texto. Cuando llegue ese hito,
 *    o (a) extraemos solo la porción `text` con un parser incremental,
 *    o (b) hacemos una segunda llamada sin formato JSON para streaming
 *    + una de clasificación. Decisión deferida.
 *
 * Browser-safe: usa `fetch` global. No importa nada de Node.
 */

import { z } from 'zod';
import type { ILLMModule, LLMRequest, LLMResponse } from '../../interfaces/ILLMModule.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import { type Emotion, EMOTIONS, isEmotion } from '../../types/emotions.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const OllamaLLMConfigSchema = z.object({
  /** Nombre del modelo en Ollama (e.g. `qwen2.5:3b`, `qwen2.5:14b`). */
  model: z.string().min(1, 'OllamaLLM: `model` es obligatorio'),
  /** URL base del servidor Ollama. Default `http://localhost:11434`. */
  host: z.string().url().default('http://localhost:11434'),
  /** Temperatura de muestreo. 0.0 = determinista, 2.0 = muy creativo. */
  temperature: z.number().min(0).max(2).default(0.7),
  /** Timeout de la request en ms. Default 60s (modelos chicos responden <10s). */
  timeoutMs: z.number().int().positive().default(60_000),
});

export type OllamaLLMConfig = z.infer<typeof OllamaLLMConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class OllamaLLMError extends Error {
  constructor(message: string, cause?: unknown) {
    // El segundo argumento del constructor de `Error` acepta `{ cause }`
    // desde ES2022 — eso pone la causa en `this.cause` sin necesidad
    // de declararlo como parámetro de clase.
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OllamaLLMError';
  }
}

// ─── Schema de la respuesta del modelo (lo que el LLM emite) ──────────

const OllamaChatResponseSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean(),
  eval_count: z.number().optional(),
  prompt_eval_count: z.number().optional(),
});

/** Schema que le pasamos a Ollama para forzar el formato de salida. */
function buildOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      text: { type: 'string' },
      emotion: { type: 'string', enum: [...EMOTIONS] },
    },
    required: ['text', 'emotion'],
    additionalProperties: false,
  };
}

// ─── Implementación ───────────────────────────────────────────────────

export class OllamaLLM implements ILLMModule {
  readonly id: string;
  private readonly config: OllamaLLMConfig;
  private readonly logger: Logger;

  constructor(rawConfig: unknown, deps: ModuleDeps) {
    const result = OllamaLLMConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      throw new OllamaLLMError(
        `OllamaLLM: config inválida — ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    this.config = result.data;
    this.logger = deps.logger.child({ module: 'OllamaLLM' });
    this.id = `llm:ollama:${this.config.model}`;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const messages: { role: string; content: string }[] = [];
    if (request.systemPrompt !== undefined && request.systemPrompt.length > 0) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    if (request.context !== undefined && request.context.length > 0) {
      // Inyectamos el contexto adicional como mensaje system también — el
      // LLM lo tratará como instrucción, no como un turno de usuario.
      messages.push({ role: 'system', content: request.context });
    }
    messages.push({ role: 'user', content: request.text });

    const body = {
      model: this.config.model,
      messages,
      stream: false,
      format: buildOutputSchema(),
      options: {
        temperature: this.config.temperature,
      },
    };

    const url = `${this.config.host}/api/chat`;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new OllamaLLMError(`OllamaLLM: fallo al llamar a ${url}`, err);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '<sin cuerpo>');
      throw new OllamaLLMError(`OllamaLLM: ${response.status} ${response.statusText} — ${text}`);
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (err) {
      throw new OllamaLLMError('OllamaLLM: respuesta no es JSON', err);
    }

    const parsed = OllamaChatResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OllamaLLMError(
        `OllamaLLM: respuesta no tiene el shape esperado — ${parsed.error.message}`,
      );
    }

    const content = parsed.data.message.content;
    const { text, emotion } = this.parseContent(content);

    return {
      text,
      emotion,
      tokensUsed: parsed.data.eval_count,
    };
  }

  /**
   * Parsea el `message.content` (que el modelo emitió como JSON
   * estructurado). Si por algún motivo no parsea o trae una emoción
   * desconocida, degradamos: devolvemos el contenido crudo como `text`
   * y `emotion: 'neutral'`. Loguea el problema a `warn` para diagnóstico.
   */
  private parseContent(content: string): { text: string; emotion: Emotion } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.logger.warn('content no parseó como JSON, degradando a neutral');
      return { text: content, emotion: 'neutral' };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      this.logger.warn('content parseó pero no es objeto, degradando');
      return { text: content, emotion: 'neutral' };
    }
    const record = parsed as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text : content;
    const emotion = isEmotion(record.emotion) ? record.emotion : 'neutral';
    if (!isEmotion(record.emotion)) {
      this.logger.warn(`emoción desconocida "${String(record.emotion)}", usando neutral`);
    }
    return { text, emotion };
  }
}
