export interface MemoryEntry {
  /**
   * Identificador único de la entrada. UUID v7 generado por el caller
   * (típicamente el pipeline) antes de pasarla a `save`. Se usa como
   * clave externa al sincronizar con backends remotos (Letta) para
   * garantizar idempotencia. Ver ADR 0017.
   */
  id: string;
  /**
   * Rol del turno:
   * - `user` / `assistant`: conversación normal.
   * - `tool`: acción agéntica que Shiro ejecutó (ADR 0022 §6). El `text`
   *   es un resumen legible en primera persona (alimenta el contexto del
   *   LLM y los embeddings de `searchSemantic`); los detalles estructurados
   *   (tool, args, resultado, aprobación) viajan en `metadata` con la forma
   *   de {@link ToolTurnMetadata}.
   */
  role: 'user' | 'assistant' | 'tool';
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
 * Forma de `metadata` en los turnos con `role: 'tool'` (ADR 0022 §6). Se
 * guarda íntegra en el WAL local; Letta solo conserva el `text` + el tag de
 * rol (la metadata estructurada no se persiste en Letta, ver `letta-memory`).
 */
export interface ToolTurnMetadata {
  /** Marca discriminante para distinguir estos turnos en `metadata`. */
  kind: 'tool';
  /** Id namespaced de la tool ejecutada (p.ej. `fs:read`). */
  toolId: string;
  /** Nombre LLM-safe de la tool (p.ej. `fs_read`). */
  toolName: string;
  /** Argumentos con los que se invocó (tal cual los pasó el modelo). */
  args: unknown;
  /** Resultado simplificado de la ejecución. */
  result: { ok: boolean; output: string };
  /**
   * Decisión de aprobación: `true`/`false` para tools `confirm`, `null` para
   * tools `auto` (no requieren aprobación).
   */
  approved: boolean | null;
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
