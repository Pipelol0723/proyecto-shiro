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
   * Genera respuesta como stream de chunks de texto. Opcional pero
   * recomendado — habilita el objetivo de latencia <2s end-to-end.
   *
   * Si la impl no soporta streaming nativo, omitir este método y el
   * caller usará `generate` con la respuesta completa.
   */
  generateStream?(request: LLMRequest): AsyncIterable<string>;
}
