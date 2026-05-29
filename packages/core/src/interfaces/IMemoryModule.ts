export interface MemoryEntry {
  /**
   * Identificador único de la entrada. UUID v7 generado por el caller
   * (típicamente el pipeline) antes de pasarla a `save`. Se usa como
   * clave externa al sincronizar con backends remotos (Letta) para
   * garantizar idempotencia. Ver ADR 0017.
   */
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /**
   * Identificador del usuario. En la mayoría de instalaciones será
   * un valor constante (un solo dueño del companion), pero el campo
   * permite futuras multi-usuario.
   */
  userId: string;
  /** Metadata libre (emoción detectada, modelo usado, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Contrato de un módulo de memoria persistente.
 *
 * Implementaciones previstas (Fase 3):
 * - `LettaMemory`: long-term memory inteligente vía Letta (Docker).
 * - `LocalMemory`: SQLite simple, fallback si Letta no disponible.
 *
 * Ambas implementan los mismos métodos. La diferencia es la sofisticación
 * (Letta hace consolidación y búsqueda semántica nativas; LocalMemory
 * solo guarda y devuelve por orden cronológico).
 */
export interface IMemoryModule {
  readonly id: string;

  /** Persiste una entrada (turno de conversación). */
  save(entry: MemoryEntry): Promise<void>;

  /**
   * Recupera los últimos `limit` turnos del usuario indicado,
   * ordenados de más antiguo a más reciente (apto para incluir
   * directo en el contexto del LLM).
   */
  getRecent(userId: string, limit: number): Promise<MemoryEntry[]>;

  /**
   * Búsqueda semántica por similitud (embeddings). Opcional —
   * solo implementaciones como Letta lo soportan nativamente.
   */
  searchSemantic?(query: string, userId: string, limit: number): Promise<MemoryEntry[]>;

  /** Limpia toda la memoria del usuario. Útil para tests y opción "olvidar". */
  clear(userId: string): Promise<void>;
}
