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
 * Forma de `metadata` en los turnos `role: 'tool'` que resumen una **sesión de
 * self-dev** (ADR 0023, Fase 2). Reusa el rol `tool` (memoria interna, filtrada
 * del chat) — así Shiro recuerda qué propuso sin un rol nuevo ni migración de
 * SQLite. Como con {@link ToolTurnMetadata}, la estructura vive en el WAL; a
 * Letta va solo el `text`.
 */
export interface SelfDevTurnMetadata {
  /** Marca discriminante para distinguir estos turnos de los de `tool`. */
  kind: 'selfdev';
  /** Tema que arrancó la sesión. */
  topic: string;
  /** True si terminó abriendo un PR. */
  ok: boolean;
  /** URL del PR, si se abrió (`ok`). */
  prUrl?: string;
  /** Rama `shiro/<topic>` (queda viva aun si `!ok`, para inspección). */
  branch?: string;
  /** Motivo del fallo, si `!ok`. */
  reason?: string;
  /** Resumen de lo que cambió (la respuesta final del LLM), si lo hubo. */
  summary?: string;
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
