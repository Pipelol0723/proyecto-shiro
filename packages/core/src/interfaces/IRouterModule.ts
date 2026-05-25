import type { LLMRequest } from './ILLMModule.js';

/**
 * Niveles de LLM disponibles. `local` es gratis y rápido pero
 * limitado; `cloud` es caro y lento pero mejor calidad.
 */
export type LLMTier = 'local' | 'cloud';

/**
 * Contrato del router de LLMs.
 *
 * Implementación prevista (Fase 2):
 * - `HybridRouter`: usa el LLM local como **clasificador rápido**
 *   para decidir si la pregunta es "simple" (resuelve local) o
 *   "compleja" (escala a cloud).
 *
 * El router NO ejecuta el LLM — solo decide. El orchestrator usa
 * la decisión para invocar el módulo correspondiente.
 */
export interface IRouterModule {
  readonly id: string;

  /**
   * Decide qué tier de LLM debe procesar el request.
   *
   * Reglas no fijadas en el contrato — cada impl tiene su propio
   * algoritmo (heurísticas, clasificador con embeddings, etc.).
   */
  route(request: LLMRequest): Promise<LLMTier>;
}
