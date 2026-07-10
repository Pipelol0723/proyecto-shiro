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
import type {
  GenerateWithToolsOptions,
  ILLMModule,
  LLMRequest,
  LLMResponse,
} from '../../interfaces/ILLMModule.js';
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
  /**
   * Cota de vueltas LLM↔tools en el loop tool-use (ADR 0022 §5). Evita
   * que el modelo entre en bucle pidiendo tools. Default 5.
   */
  max_tool_rounds: z.number().int().positive().default(5),
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

/**
 * La tool `respond` — el "canal" del structured output `{text, emotion}`.
 * En `generate` es la única tool (forzada). En `generateWithTools` es la
 * tool TERMINAL del loop: el modelo la llama cuando ya tiene la respuesta
 * final, en vez de pedir otra herramienta.
 */
function respondTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: 'Responde al usuario con un texto y la emoción dominante de la respuesta.',
    input_schema: buildResponseToolSchema() as Anthropic.Tool.InputSchema,
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

    const system = this.buildSystem(request);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.max_tokens,
        temperature: this.config.temperature,
        ...(system.length > 0 ? { system } : {}),
        messages: [{ role: 'user', content: request.text }],
        tools: [respondTool()],
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
   * Loop tool-use (ADR 0022 §5). Ofrece las `options.tools` + la tool
   * terminal `respond`, con `tool_choice: any` (el modelo SIEMPRE llama
   * una tool: o una real, o `respond`). Cada vuelta: si pide `respond` →
   * respuesta final; si pide una tool real → la ejecuta vía
   * `options.executeTool` (donde vive el gate de permisos) y mete el
   * `tool_result` en la conversación → siguiente vuelta. Cota `maxRounds`.
   */
  async generateWithTools(
    request: LLMRequest,
    options: GenerateWithToolsOptions,
  ): Promise<LLMResponse> {
    if (this.client === null) {
      throw new AnthropicLLMError(
        'AnthropicLLM: ANTHROPIC_API_KEY no está configurada — no se puede invocar generateWithTools.',
      );
    }
    const client = this.client;
    const system = this.buildSystem(request);
    const tools: Anthropic.Tool[] = [
      ...options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      respondTool(),
    ];
    const maxRounds = options.maxRounds ?? this.config.max_tool_rounds;
    const maxTokens = options.maxTokens ?? this.config.max_tokens;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: request.text }];
    let totalTokens = 0;

    for (let round = 0; round < maxRounds; round++) {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: this.config.model,
          max_tokens: maxTokens,
          temperature: this.config.temperature,
          ...(system.length > 0 ? { system } : {}),
          messages,
          tools,
          tool_choice: { type: 'any' },
        });
      } catch (err) {
        throw new AnthropicLLMError('AnthropicLLM: fallo al llamar a la API (tool loop)', err);
      }
      totalTokens += response.usage.input_tokens + response.usage.output_tokens;
      // Un tool_use grande (p.ej. `fs:write` de un archivo entero) truncado por
      // `max_tokens` llega con el JSON de args incompleto → la tool falla con
      // args inválidos. Avisamos claro en vez de dejarlo como un `ok:false` mudo.
      if (response.stop_reason === 'max_tokens') {
        this.logger.warn(
          `respuesta truncada por max_tokens (${String(maxTokens)}) — un tool_use grande puede quedar con args incompletos. Subí maxTokens.`,
        );
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const respondBlock = toolUses.find((b) => b.name === TOOL_NAME);
      if (respondBlock) {
        const { text, emotion } = this.parseRespondInput(
          respondBlock.input as Record<string, unknown>,
        );
        return { text, emotion, tokensUsed: totalTokens };
      }
      if (toolUses.length === 0) {
        // Sin tool_use (raro con tool_choice:any). Degradamos a texto.
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
        return { text: textBlock?.text ?? '', emotion: 'neutral', tokensUsed: totalTokens };
      }

      // Ejecuta cada tool real y prepara los tool_result para la próxima vuelta.
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const result = await options.executeTool(use.name, use.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: result.output,
          is_error: !result.ok,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    this.logger.warn(`tool loop superó ${String(maxRounds)} vueltas sin respuesta final`);
    return {
      text: '(no pude completar la tarea con las herramientas disponibles)',
      emotion: 'neutral',
      tokensUsed: totalTokens,
    };
  }

  /**
   * Construye el `system` de Anthropic: systemPrompt del personaje +
   * contexto de memoria del turno, separados.
   */
  private buildSystem(request: LLMRequest): string {
    const parts: string[] = [];
    if (request.systemPrompt !== undefined && request.systemPrompt.length > 0) {
      parts.push(request.systemPrompt);
    }
    if (request.context !== undefined && request.context.length > 0) {
      parts.push(`Contexto adicional:\n${request.context}`);
    }
    return parts.join('\n\n');
  }

  /** Lee `{ text, emotion }` del `input` de la tool `respond`. */
  private parseRespondInput(input: Record<string, unknown>): { text: string; emotion: Emotion } {
    const text = typeof input.text === 'string' ? input.text : '';
    const emotion: Emotion = isEmotion(input.emotion) ? input.emotion : 'neutral';
    if (!isEmotion(input.emotion)) {
      this.logger.warn(`emoción desconocida "${String(input.emotion)}", usando neutral`);
    }
    return { text, emotion };
  }

  /**
   * Busca el bloque `tool_use` `respond` del response y extrae
   * `{ text, emotion }`. Si no hay tool_use válido, degrada al primer
   * bloque de texto disponible con emoción `'neutral'`.
   */
  private extractToolUse(response: Anthropic.Message): { text: string; emotion: Emotion } {
    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (toolBlock?.name === TOOL_NAME) {
      return this.parseRespondInput(toolBlock.input as Record<string, unknown>);
    }
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    this.logger.warn('respuesta sin tool_use válido, degradando a texto crudo + neutral');
    return { text: textBlock?.text ?? '', emotion: 'neutral' };
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
