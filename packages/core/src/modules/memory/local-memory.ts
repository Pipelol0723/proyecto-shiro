/**
 * LocalMemory — Write-Ahead Log de memoria persistente en SQLite.
 *
 * Rol (ver ADR 0017): persistencia inmediata de cada turno antes de
 * empujarlo a Letta. NO se lee desde el path normal del pipeline —
 * solo el `MemoryManager` lo consulta para drenar pendientes hacia
 * Letta y para marcar entradas como sincronizadas.
 *
 * Síncrono por diseño: `better-sqlite3` es síncrono y las operaciones
 * sobre un archivo local son sub-ms; bloquear el event loop ese ratito
 * vale más que la complejidad de un wrapper asíncrono.
 *
 * No implementa `IMemoryModule` a propósito — el contrato público lo
 * cumple el `MemoryManager` (PR 4). LocalMemory es pieza interna del
 * paquete `memory` con métodos específicos del rol WAL.
 */

import Database, { type Database as DatabaseInstance, type Statement } from 'better-sqlite3';
import type { MemoryEntry } from '../../interfaces/IMemoryModule.js';
import type { Logger } from '../../core/logger.js';

export interface LocalMemoryOptions {
  /**
   * Ruta al archivo SQLite. Usar `':memory:'` para tests — DB efímera
   * en RAM, no escribe en disco.
   */
  dbPath: string;
  logger?: Logger;
}

/**
 * Fila tal como vive en SQLite. Solo uso interno; el caller siempre
 * recibe `MemoryEntry`.
 */
interface MessageRow {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  metadata: string | null;
  synced_at: string | null;
}

export class LocalMemory {
  private readonly db: DatabaseInstance;
  private readonly logger: Logger | undefined;

  private readonly stmtInsert: Statement;
  private readonly stmtGetPending: Statement;
  private readonly stmtGetPendingLimited: Statement;
  private readonly stmtMarkSynced: Statement;
  private readonly stmtClear: Statement;
  private readonly stmtPendingCount: Statement;

  constructor(options: LocalMemoryOptions) {
    this.db = new Database(options.dbPath);
    this.logger = options.logger?.child({ module: 'LocalMemory' });

    // WAL mode de SQLite: mejor concurrencia entre reads y writes.
    // No aplica a DBs en memoria (`:memory:`) — silenciamos esa diferencia.
    if (options.dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }

    this.initSchema();

    this.stmtInsert = this.db.prepare(
      `INSERT INTO messages (id, user_id, role, text, timestamp, metadata)
       VALUES (@id, @user_id, @role, @text, @timestamp, @metadata)`,
    );
    this.stmtGetPending = this.db.prepare(
      `SELECT id, user_id, role, text, timestamp, metadata, synced_at
       FROM messages
       WHERE synced_at IS NULL
       ORDER BY timestamp ASC, id ASC`,
    );
    this.stmtGetPendingLimited = this.db.prepare(
      `SELECT id, user_id, role, text, timestamp, metadata, synced_at
       FROM messages
       WHERE synced_at IS NULL
       ORDER BY timestamp ASC, id ASC
       LIMIT ?`,
    );
    this.stmtMarkSynced = this.db.prepare(`UPDATE messages SET synced_at = ? WHERE id = ?`);
    this.stmtClear = this.db.prepare(`DELETE FROM messages WHERE user_id = ?`);
    this.stmtPendingCount = this.db.prepare(
      `SELECT COUNT(*) AS n FROM messages WHERE synced_at IS NULL`,
    );
  }

  /**
   * Persiste una entrada. Síncrono. Lanza si el `id` ya existía —
   * los callers deben generar UUID nuevos por entry (ver ADR 0017).
   */
  save(entry: MemoryEntry): void {
    this.stmtInsert.run({
      id: entry.id,
      user_id: entry.userId,
      role: entry.role,
      text: entry.text,
      timestamp: entry.timestamp,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    });
  }

  /**
   * Devuelve las entradas pendientes de sincronizar (synced_at IS NULL)
   * en orden cronológico ASC. Opcional `limit` para acotar batches.
   */
  getPending(limit?: number): MemoryEntry[] {
    const rows =
      limit !== undefined
        ? (this.stmtGetPendingLimited.all(limit) as MessageRow[])
        : (this.stmtGetPending.all() as MessageRow[]);
    return rows.map(rowToEntry);
  }

  /**
   * Marca una entrada como sincronizada con Letta. Si el `id` no existe,
   * la sentencia simplemente no afecta a ninguna fila (no lanza).
   */
  markSynced(id: string, syncedAt: string = new Date().toISOString()): void {
    this.stmtMarkSynced.run(syncedAt, id);
  }

  /** Borra todas las entradas del usuario indicado. Síncrono. */
  clear(userId: string): void {
    const result = this.stmtClear.run(userId);
    this.logger?.debug(`clear(${userId}): ${result.changes} filas borradas`);
  }

  /** Conteo de pendientes. Útil para diagnostics del drainer. */
  pendingCount(): number {
    const row = this.stmtPendingCount.get() as { n: number };
    return row.n;
  }

  /** Cierra la conexión. Llamar en shutdown del server. */
  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        role       TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        text       TEXT NOT NULL,
        timestamp  TEXT NOT NULL,
        metadata   TEXT,
        synced_at  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_pending
        ON messages(timestamp) WHERE synced_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_messages_user_time
        ON messages(user_id, timestamp);
    `);
  }
}

function rowToEntry(row: MessageRow): MemoryEntry {
  const entry: MemoryEntry = {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    text: row.text,
    timestamp: row.timestamp,
  };
  if (row.metadata !== null) {
    entry.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  }
  return entry;
}
