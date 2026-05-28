/**
 * AnthropicLLM — cliente de la API de Anthropic vía `@anthropic-ai/sdk`.
 *
 * Análogo a `OllamaLLM` pero contra `api.anthropic.com`. La diferencia
 * fundamental es que Anthropic no tiene `format: json` con schema; en
 * su lugar usamos **tool use forzado** (ADR 0014 lo recoge):
 *
 *   - Declaramos una "herramienta" `respond` cuyo `input_schema` es
 *     `{ text: string, emotion: <enum> }`.
 *   - `tool_choice: { type: 'tool', name: 'respond' }` obliga al modelo
 *     a llamar exactamente esa herramienta.
 *   - Extraemos el `tool_use` block del response y leemos su `input`.
 *
 * El resultado es equivalente al `format` de Ollama: el modelo emite
 * JSON garantizado. Si por algún motivo no llega un tool_use válido,
 * degradamos a `emotion: 'neutral'` con el texto crudo del mejor
 * bloque disponible.
 *
 * Lectura de la API key: `process.env.ANTHROPIC_API_KEY` al construir.
 * Si falta, el constructor **no lanza** — solo deja `apiKey: undefined`.
 * `generate()` lanza con mensaje claro la primera vez que se invoca.
 * Razón: bootstrap del server no debe romper si el dev solo usa Ollama.
 *
 * Browser-safe a nivel de tipos (no importa `node:*`), pero el cliente
 * **solo debe correr server-side** porque la key vive en `process.env`.
 * ADR 0012 lo enforza ubicando este módulo en el server.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ILLMModule, LLMRequest, LLMResponse } from '../../interfaces/ILLMModule.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import { type Emotion, EMOTIONS, isEmotion } from '../../types/emotions.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const AnthropicLLMConfigSchema = z.object({
  /**
   * Modelo a usar. Default `claude-sonnet-4-6`. Lista de modelos
   * disponibles: https://docs.claude.com/en/docs/about-claude/models
   */
  model: z.string().min(1).default('claude-sonnet-4-6'),
  /** Tokens máximos de la respuesta. Default 1024. */
  max_tokens: z.number().int().positive().default(1024),
  /** Temperatura. Anthropic usa 0-1 (no 0-2 como Ollama). */
  temperature: z.number().min(0).max(1).default(1.0),
});

export type AnthropicLLMConfig = z.infer<typeof AnthropicLLMConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class AnthropicLLMError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AnthropicLLMError';
  }
}

// ─── Opciones de DI ───────────────────────────────────────────────────

export interface AnthropicLLMOptions {
  /**
   * Cliente del SDK pre-construido. Útil para tests (mock) y para
   * casos donde el caller quiera reutilizar conexiones. Si se omite,
   * el constructor crea uno leyendo `ANTHROPIC_API_KEY` del entorno.
   */
  client?: Anthropic;
  /**
   * Override de la API key. Sobrescribe la del entorno. Útil cuando
   * el server obtiene la key por otro canal (vault, secret manager).
   */
  apiKey?: string;
}

// ─── Tool schema (input que el modelo debe satisfacer) ─────────────────

const TOOL_NAME = 'respond';

function buildResponseToolSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'La respuesta verbal de Shiro al usuario.' },
      emotion: {
        type: 'string',
        enum: [...EMOTIONS],
        description: 'La emoción dominante de la respuesta — la usa el avatar y el TTS.',
      },
    },
    required: ['text', 'emotion'],
  };
}

// ─── Implementación ───────────────────────────────────────────────────

export class AnthropicLLM implements ILLMModule {
  readonly id: string;
  private readonly config: AnthropicLLMConfig;
  private readonly logger: Logger;
  private readonly client: Anthropic | null;

  constructor(rawConfig: unknown, deps: ModuleDeps, options: AnthropicLLMOptions = {}) {
    const result = AnthropicLLMConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      throw new AnthropicLLMError(
        `AnthropicLLM: config inválida — ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    this.config = result.data;
    this.logger = deps.logger.child({ module: 'AnthropicLLM' });
    this.id = `llm:anthropic:${this.config.model}`;

    if (options.client) {
      // DI: tests inyectan un mock del cliente del SDK.
      this.client = options.client;
    } else {
      const apiKey = options.apiKey ?? readApiKeyFromEnv();
      if (apiKey === undefined) {
        // Bootstrap no debe romper si el dev solo usa Ollama. Logueamos
        // la falta y dejamos el client como null — `generate` lanzará.
        this.logger.warn(
          'ANTHROPIC_API_KEY no está definida. AnthropicLLM no podrá generar hasta configurarla.',
        );
        this.client = null;
      } else {
        this.client = new Anthropic({ apiKey });
      }
    }
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (this.client === null) {
      throw new AnthropicLLMError(
        'AnthropicLLM: ANTHROPIC_API_KEY no está configurada — no se puede invocar generate.',
      );
    }

    // Construye el contexto. Anthropic separa `system` de `messages` —
    // el systemPrompt va aparte (no como mensaje role:'system' como en
    // Ollama). El `context` adicional se concatena al system con un
    // separador para no perder información.
    const systemParts: string[] = [];
    if (request.systemPrompt !== undefined && request.systemPrompt.length > 0) {
      systemParts.push(request.systemPrompt);
    }
    if (request.context !== undefined && request.context.length > 0) {
      systemParts.push(`Contexto adicional:\n${request.context}`);
    }
    const system = systemParts.join('\n\n');

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.max_tokens,
        temperature: this.config.temperature,
        ...(system.length > 0 ? { system } : {}),
        messages: [{ role: 'user', content: request.text }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Responde al usuario con un texto y la emoción dominante de la respuesta.',
            // Anthropic acepta un JSON Schema arbitrario; nuestro objeto
            // cumple la forma que pide.
            input_schema: buildResponseToolSchema() as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });
    } catch (err) {
      throw new AnthropicLLMError('AnthropicLLM: fallo al llamar a la API', err);
    }

    const { text, emotion } = this.extractToolUse(response);

    return {
      text,
      emotion,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }

  /**
   * Busca el bloque `tool_use` del response y extrae `{ text, emotion }`.
   * Si no hay tool_use (raro con `tool_choice` forzado pero posible si la
   * API cambia o el modelo se rebela), degradamos al primer bloque de
   * texto disponible con emoción `'neutral'`.
   */
  private extractToolUse(response: Anthropic.Message): { text: string; emotion: Emotion } {
    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolBlock?.name === TOOL_NAME) {
      const input = toolBlock.input as Record<string, unknown>;
      const text = typeof input.text === 'string' ? input.text : '';
      const emotion: Emotion = isEmotion(input.emotion) ? input.emotion : 'neutral';
      if (!isEmotion(input.emotion)) {
        this.logger.warn(`emoción desconocida "${String(input.emotion)}", usando neutral`);
      }
      return { text, emotion };
    }

    // Fallback: el modelo no emitió tool_use válido. Buscamos cualquier
    // texto y degradamos a neutral.
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    this.logger.warn('respuesta sin tool_use válido, degradando a texto crudo + neutral');
    return {
      text: textBlock?.text ?? '',
      emotion: 'neutral',
    };
  }
}

/**
 * Lee `ANTHROPIC_API_KEY` del entorno si Node está disponible. En
 * browser (testing con jsdom, por ejemplo) devuelve `undefined`.
 *
 * Un string vacío también se trata como "ausente" — el SDK fallaría
 * con apiKey="", mejor degradar al mismo camino que cuando falta.
 */
function readApiKeyFromEnv(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  const raw = process.env.ANTHROPIC_API_KEY;
  if (raw === undefined || raw.length === 0) return undefined;
  return raw;
}
