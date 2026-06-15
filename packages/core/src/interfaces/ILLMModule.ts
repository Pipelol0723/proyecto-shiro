import type { Emotion } from '../types/emotions.js';

export interface LLMRequest {
  /** Texto del usuario que se envía al modelo. */
  text: string;
  /**
   * System prompt del personaje. Lo construye `buildSystemPrompt(character)`
   * a partir del YAML del personaje activo. Persiste turn a turn — el
   * carácter no cambia.
   *
   * Opcional para no forzar a los clientes de test a construirlo.
   */
  systemPrompt?: string;
  /**
   * Contexto adicional inyectado por turno: historial de conversación
   * reciente (módulo Memory), datos relevantes de búsqueda semántica.
   * La forma exacta queda a discreción del LLM que lo consume.
   */
  context?: string;
  userId?: string;
}

export interface LLMResponse {
  text: string;
  /**
   * Emoción detectada/decidida por el modelo. Si no la provee, el avatar
   * usa 'neutral'.
   */
  emotion?: Emotion;
  /** Útil para logging y rate-limiting de proveedores cloud. */
  tokensUsed?: number;
}

/**
 * Definición de una herramienta que se le ofrece al LLM (ADR 0022). Forma
 * genérica e independiente del proveedor: el `inputSchema` es un JSON
 * Schema (el módulo LLM lo traduce a su formato — p.ej. `tool_use` de
 * Anthropic). El pipeline las construye desde el slot `tools`.
 */
export interface LLMToolDefinition {
  /** Nombre LLM-safe (`^[a-zA-Z0-9_-]{1,64}$`), p.ej. `fs_read`. */
  name: string;
  description: string;
  /** JSON Schema de los argumentos. */
  inputSchema: Record<string, unknown>;
}

/**
 * Ejecuta una tool por `name` y devuelve un resultado simple (lo que el
 * LLM necesita para construir el `tool_result`). Lo provee el pipeline:
 * ahí viven el gate de permisos (`auto` vs `confirm`) y, más adelante, el
 * flujo de aprobación. El módulo LLM solo lo invoca dentro del loop.
 */
export type LLMToolExecutor = (
  name: string,
  args: unknown,
) => Promise<{ ok: boolean; output: string }>;

/** Opciones del loop tool-use (ADR 0022 §5). */
export interface GenerateWithToolsOptions {
  tools: LLMToolDefinition[];
  executeTool: LLMToolExecutor;
  /** Cota de vueltas LLM↔tools para no entrar en bucle. Default impl-dependiente. */
  maxRounds?: number;
}

/**
 * Contrato de un módulo LLM (proveedor de generación de texto).
 *
 * Implementaciones previstas:
 * - `OllamaLLM` (local, Qwen 2.5)
 * - `AnthropicLLM` (cloud, Claude Sonnet)
 *
 * Diseño streaming-ready: `generateStream` es opcional. El orchestrator
 * usa streaming si está disponible, cae a `generate` si no.
 */
export interface ILLMModule {
  /**
   * Identificador del módulo (usado en logs y en el HybridRouter).
   * Convención: `llm:<proveedor>` p. ej. `llm:ollama`, `llm:anthropic`.
   */
  readonly id: string;

  /** Genera respuesta completa, request/response. */
  generate(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Genera respuesta pudiendo **usar herramientas** en un loop (ADR 0022
   * §5): el modelo decide si llamar una tool; el pipeline la ejecuta vía
   * `executeTool` y el resultado vuelve al modelo hasta que produce la
   * respuesta final `{text, emotion}`.
   *
   * Opcional — solo lo implementan los proveedores con tool-use fiable
   * (Claude). Los locales (Qwen 3b) lo omiten y el pipeline cae a
   * `generate` (ADR 0022 §5). El gate de permisos vive en `executeTool`.
   */
  generateWithTools?(request: LLMRequest, options: GenerateWithToolsOptions): Promise<LLMResponse>;

  /**
   * Genera respuesta como stream de chunks de texto. Opcional pero
   * recomendado — habilita el objetivo de latencia <2s end-to-end.
   *
   * Si la impl no soporta streaming nativo, omitir este método y el
   * caller usará `generate` con la respuesta completa.
   */
  generateStream?(request: LLMRequest): AsyncIterable<string>;
}
