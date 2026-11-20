/**
 * LocalMemory — el registro local de la memoria, en SQLite.
 *
 * Rol (ver ADR 0017 y su enmienda del 2026-11-19): cada turno se guarda aquí
 * antes de empujarlo a Letta, y aquí se queda. De él salen el historial
 * reciente (`getRecent`), lo pendiente de sincronizar y, si hiciera falta,
 * la reindexación de Letta. No es un WAL que se vacía: es el registro
 * completo de la conversación.
 *
 * El esquema lleva versión (`PRAGMA user_version`). Al abrir una base de una
 * versión anterior se migra, dejando antes una copia junto al archivo.
 *
 * Síncrono por diseño: `better-sqlite3` es síncrono y las operaciones
 * sobre un archivo local son sub-ms; bloquear el event loop ese ratito
 * vale más que la complejidad de un wrapper asíncrono.
 *
 * No implementa `IMemoryModule` a propósito — el contrato público lo
 * cumple el `MemoryManager` (PR 4). LocalMemory es pieza interna del
 * paquete `memory` con métodos específicos del rol WAL.
 */

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as DatabaseInstance, type Statement } from 'better-sqlite3';
import type { MemoryEntry, RecentOptions } from '../../interfaces/IMemoryModule.js';
import type { Logger } from '../../core/logger.js';

/**
 * Versión del esquema de `memory.db`, guardada en `PRAGMA user_version`.
 *
 * - 0: bases creadas antes de versionar (sin marca).
 * - 1: tablas `messages` (rol `user`, `assistant` o `tool`) y `meta`, con sus
 *   índices. Es el esquema que ya había al introducir la versión, más el
 *   índice por tiempo que usa el historial reciente.
 *
 * Para cambiar el esquema: sube este número y añade el paso en `migrate`.
 */
export const SCHEMA_VERSION = 1;

/**
 * Tope de la salida de una tool que se guarda en un turno `tool`. El resumen
 * legible del turno va aparte, en `text`; esto acota el detalle, que podía
 * ser un archivo entero y se quedaba para siempre.
 */
export const MAX_TOOL_OUTPUT_CHARS = 4_000;

/**
 * Normaliza la ruta del binario nativo antes de pasarla a better-sqlite3,
 * que internamente hace `require()` del `.node`.
 *
 * En el sidecar empaquetado (ADR 0024), el lanzador Tauri resuelve esta
 * ruta con `resource_dir()`, que en Windows devuelve un path con el
 * **prefijo verbatim `\\?\`** (long-path). Nuestro código de configs lo
 * tolera (usa `fs` normal), pero el resolver de módulos de `pkg` NO: al
 * hacer `require('\\?\D:\…\better_sqlite3.node')` mis-parsea el prefijo,
 * camina hacia la raíz del disco y revienta con `EISDIR lstat 'D:'`.
 * Quitamos el prefijo aquí, en el único punto donde la ruta llega a un
 * `require()` nativo.
 *
 * Devuelve `undefined` si el input es vacío/undefined — equivalente a no
 * pasar `nativeBinding` (better-sqlite3 resuelve solo, caso dev).
 */
export function normalizeNativeBinding(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  // `\\?\UNC\servidor\share` → `\\servidor\share`
  if (raw.startsWith('\\\\?\\UNC\\')) return `\\${raw.slice(7)}`;
  // `\\?\D:\…` → `D:\…`
  if (raw.startsWith('\\\\?\\')) return raw.slice(4);
  return raw;
}

export interface LocalMemoryOptions {
  /**
   * Ruta al archivo SQLite. Usar `':memory:'` para tests — DB efímera
   * en RAM, no escribe en disco.
   */
  dbPath: string;
  logger?: Logger;
  /**
   * Ruta absoluta al binario nativo `better_sqlite3.node`. Solo necesario
   * cuando el proceso corre como ejecutable empaquetado (sidecar Tauri,
   * ADR 0024): `pkg`/`ncc` empaquetan el JS pero NO el addon nativo, que
   * debe cargarse desde un path real del disco junto al `.exe`. En
   * desarrollo (Node normal) se deja `undefined` y `better-sqlite3`
   * resuelve su binario por su cuenta.
   *
   * Si se omite, se intenta `process.env.SHIRO_SQLITE_NATIVE_BINDING`
   * como fallback — así el bootstrap del sidecar solo necesita exportar
   * esa env var (la setea el lanzador Tauri) sin tocar este código.
   */
  nativeBinding?: string;
}

/**
 * Fila tal como vive en SQLite. Solo uso interno; el caller siempre
 * recibe `MemoryEntry`.
 */
interface MessageRow {
  id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: string;
  metadata: string | null;
  synced_at: string | null;
}

/**
 * Cuerpo de columnas de la tabla `messages`. Factorizado porque se usa tanto
 * en la creación (`CREATE TABLE IF NOT EXISTS`) como en la migración que
 * reconstruye la tabla para ampliar el CHECK del rol (ADR 0022 §6).
 */
const MESSAGES_COLUMNS_DDL = `
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
  text       TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  metadata   TEXT,
  synced_at  TEXT
`;

export class LocalMemory {
  private readonly db: DatabaseInstance;
  private readonly logger: Logger | undefined;

  private readonly stmtInsert: Statement;
  private readonly stmtGetPending: Statement;
  private readonly stmtGetPendingLimited: Statement;
  private readonly stmtGetRecent: Statement;
  private readonly stmtGetRecentAnyUser: Statement;
  private readonly stmtMarkSynced: Statement;
  private readonly stmtClear: Statement;
  private readonly stmtClearAll: Statement;
  private readonly stmtPendingCount: Statement;
  private readonly stmtGetMeta: Statement;
  private readonly stmtSetMeta: Statement;

  constructor(options: LocalMemoryOptions) {
    // `better-sqlite3` no crea el directorio padre: si no existe la
    // apertura lanza con "Cannot open database because the directory
    // does not exist". Lo creamos idempotente; `recursive: true` es
    // no-op si ya está.
    if (options.dbPath !== ':memory:') {
      mkdirSync(dirname(options.dbPath), { recursive: true });
    }

    // `nativeBinding` apunta al addon nativo cuando corremos empaquetados
    // (sidecar). Si no se pasa, cae a la env var; si tampoco, `undefined`
    // y better-sqlite3 resuelve solo (caso dev). Pasar `undefined` a las
    // opciones es equivalente a no pasarlo.
    const rawBinding = options.nativeBinding ?? process.env.SHIRO_SQLITE_NATIVE_BINDING;
    const nativeBinding = normalizeNativeBinding(rawBinding);
    this.db = new Database(
      options.dbPath,
      nativeBinding !== undefined ? { nativeBinding } : undefined,
    );
    this.logger = options.logger?.child({ module: 'LocalMemory' });

    try {
      // La versión se mira antes que nada: una base de un programa más nuevo
      // no se modifica, ni siquiera su modo de diario.
      this.assertSupportedVersion(options.dbPath);

      // WAL mode de SQLite: mejor concurrencia entre reads y writes.
      // No aplica a DBs en memoria (`:memory:`) — silenciamos esa diferencia.
      if (options.dbPath !== ':memory:') {
        this.db.pragma('journal_mode = WAL');
      }

      this.migrate(options.dbPath);
    } catch (err) {
      // Sin esto el archivo quedaba abierto (y en Windows, bloqueado).
      this.db.close();
      throw err;
    }

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
    // Los últimos del usuario, del más reciente al más antiguo; quien llama
    // les da la vuelta. Usa el índice `idx_messages_user_time`. A igual marca
    // de tiempo manda el orden en que se guardaron (`rowid`).
    this.stmtGetRecent = this.db.prepare(
      `SELECT id, user_id, role, text, timestamp, metadata, synced_at
       FROM messages
       WHERE user_id = @user_id
         AND (@exclude_id IS NULL OR id <> @exclude_id)
       ORDER BY timestamp DESC, rowid DESC
       LIMIT @limit`,
    );
    // Lo mismo sin separar por usuario. Usa `idx_messages_time`.
    this.stmtGetRecentAnyUser = this.db.prepare(
      `SELECT id, user_id, role, text, timestamp, metadata, synced_at
       FROM messages
       WHERE (@exclude_id IS NULL OR id <> @exclude_id)
       ORDER BY timestamp DESC, rowid DESC
       LIMIT @limit`,
    );
    this.stmtMarkSynced = this.db.prepare(`UPDATE messages SET synced_at = ? WHERE id = ?`);
    this.stmtClear = this.db.prepare(`DELETE FROM messages WHERE user_id = ?`);
    this.stmtClearAll = this.db.prepare(`DELETE FROM messages`);
    this.stmtPendingCount = this.db.prepare(
      `SELECT COUNT(*) AS n FROM messages WHERE synced_at IS NULL`,
    );
    this.stmtGetMeta = this.db.prepare(`SELECT value FROM meta WHERE key = ?`);
    this.stmtSetMeta = this.db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
  }

  /**
   * Persiste una entrada. Síncrono. Lanza si el `id` ya existía —
   * los callers deben generar UUID nuevos por entry (ver ADR 0017).
   */
  save(entry: MemoryEntry): void {
    const metadata = entry.role === 'tool' ? capToolOutput(entry.metadata) : entry.metadata;
    this.stmtInsert.run({
      id: entry.id,
      user_id: entry.userId,
      role: entry.role,
      text: entry.text,
      timestamp: entry.timestamp,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  }

  /**
   * Los últimos `limit` turnos del usuario, del más antiguo al más reciente,
   * estén o no sincronizados con Letta. Es la fuente del historial reciente:
   * local, inmediata y disponible con Letta apagado.
   */
  getRecent(userId: string, limit: number, options: RecentOptions = {}): MemoryEntry[] {
    if (!isUsableLimit(limit)) return [];
    const rows = this.stmtGetRecent.all({
      user_id: userId,
      exclude_id: options.excludeId ?? null,
      limit,
    }) as MessageRow[];
    return rows.reverse().map(rowToEntry);
  }

  /**
   * Como `getRecent`, pero de toda la conversación, hable quien hable. Es lo
   * que usa el `MemoryManager`: la memoria es de un solo dueño y el `user_id`
   * de cada turno dice quién lo guardó, no separa memorias.
   */
  getRecentAnyUser(limit: number, options: RecentOptions = {}): MemoryEntry[] {
    if (!isUsableLimit(limit)) return [];
    const rows = this.stmtGetRecentAnyUser.all({
      exclude_id: options.excludeId ?? null,
      limit,
    }) as MessageRow[];
    return rows.reverse().map(rowToEntry);
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

  /**
   * Borra toda la conversación, la guardara quien la guardara. La tabla
   * `meta` no se toca (ahí vive el agente de Letta). Síncrono.
   */
  clearAll(): void {
    const result = this.stmtClearAll.run();
    this.logger?.debug(`clearAll: ${String(result.changes)} filas borradas`);
  }

  /** Conteo de pendientes. Útil para diagnostics del drainer. */
  pendingCount(): number {
    const row = this.stmtPendingCount.get() as { n: number };
    return row.n;
  }

  /**
   * Lee un valor de la tabla clave-valor `meta`. Devuelve `undefined`
   * si la clave no existe. Uso actual: persistir el `agent_id` de Letta
   * auto-provisionado para que sobreviva reinicios (ver ADR 0018).
   */
  getMeta(key: string): string | undefined {
    const row = this.stmtGetMeta.get(key) as { value: string } | undefined;
    return row?.value;
  }

  /** Inserta o actualiza un valor en la tabla `meta`. Síncrono. */
  setMeta(key: string, value: string): void {
    this.stmtSetMeta.run(key, value);
  }

  /**
   * Deja todos los turnos como pendientes de enviar y olvida un valor de
   * `meta`, en una sola transacción. Es la base de `reindex-memory`: los
   * turnos no se tocan, solo la marca de que ya se enviaron. Devuelve cuántos
   * estaban enviados y el valor que se olvida.
   */
  resetSync(metaKey: string): { turns: number; previous: string | undefined } {
    return this.db.transaction(() => {
      const previous = this.getMeta(metaKey);
      const result = this.db
        .prepare(`UPDATE messages SET synced_at = NULL WHERE synced_at IS NOT NULL`)
        .run();
      this.db.prepare(`DELETE FROM meta WHERE key = ?`).run(metaKey);
      return { turns: result.changes, previous };
    })();
  }

  /** Versión del esquema de la base abierta (`PRAGMA user_version`). */
  schemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number;
  }

  /** Cuánto ocupa la base y cuántos turnos guarda. Para el log de arranque. */
  stats(): { turns: number; bytes: number } {
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number };
    const pages = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    return { turns: n, bytes: pages * pageSize };
  }

  /** Cierra la conexión. Llamar en shutdown del server. */
  close(): void {
    this.db.close();
  }

  /**
   * Una base de una versión posterior no se abre: la creó un programa más
   * nuevo y este no sabe qué hay dentro. Se comprueba antes de cualquier
   * escritura, para no tocarla.
   */
  private assertSupportedVersion(dbPath: string): void {
    const current = this.schemaVersion();
    if (current <= SCHEMA_VERSION) return;
    throw new Error(
      `LocalMemory: ${dbPath} tiene el esquema en la versión ${String(current)} y este programa ` +
        `entiende hasta la ${String(SCHEMA_VERSION)}. La creó una versión más nueva de Shiro: ` +
        'actualiza el programa o apunta a otra base de datos. No se ha tocado.',
    );
  }

  /**
   * Lleva la base a `SCHEMA_VERSION`. Una base nueva o anterior a la versión
   * (v0) pasa a v1 con los pasos de siempre, que no hacen nada si ya están
   * aplicados.
   */
  private migrate(dbPath: string): void {
    const current = this.schemaVersion();
    if (current === SCHEMA_VERSION) return;
    this.backupBeforeMigration(dbPath, current);
    // v0 → v1.
    this.initSchema();
    this.db.pragma(`user_version = ${String(SCHEMA_VERSION)}`);
  }

  /**
   * Antes de migrar una base que ya tiene turnos, deja una copia tal como
   * estaba en `<archivo>.v<versión>.bak`. Si esa copia ya existe no se pisa:
   * es de un intento anterior y es la buena. Si no se puede copiar, no se
   * migra.
   *
   * La copia se escribe en un `.tmp` y se renombra al terminar: así un `.bak`
   * que existe está siempre entero, aunque un arranque se cortara a mitad.
   */
  private backupBeforeMigration(dbPath: string, fromVersion: number): void {
    if (dbPath === ':memory:' || !this.hasTurns()) return;
    const backupPath = `${dbPath}.v${String(fromVersion)}.bak`;
    if (existsSync(backupPath)) {
      this.logger?.info(`ya hay una copia previa a la migración en ${backupPath}; no se pisa`);
      return;
    }
    const tmpPath = `${backupPath}.tmp`;
    try {
      // Resto de un arranque que se cortó a mitad de copia.
      rmSync(tmpPath, { force: true });
      this.db.prepare('VACUUM INTO ?').run(tmpPath);
      renameSync(tmpPath, backupPath);
    } catch (err) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // No se puede quitar (no es un archivo, o lo tiene otro proceso): se queda.
      }
      throw new Error(
        `LocalMemory: no se pudo copiar ${dbPath} a ${backupPath} antes de migrar el esquema; ` +
          'no se ha migrado. La copia ocupa lo mismo que la base: comprueba que hay espacio y ' +
          'permiso de escritura en esa carpeta y vuelve a arrancar.',
        { cause: err },
      );
    }
    this.logger?.info(
      `esquema de memoria v${String(fromVersion)} → v${String(SCHEMA_VERSION)}: copia previa en ${backupPath}`,
    );
  }

  /** ¿Hay algún turno guardado? Falso también si la tabla aún no existe. */
  private hasTurns(): boolean {
    const table = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'`)
      .get();
    if (table === undefined) return false;
    return this.db.prepare(`SELECT 1 FROM messages LIMIT 1`).get() !== undefined;
  }

  private initSchema(): void {
    // Tablas primero (DBs nuevas nacen ya con el CHECK que incluye 'tool').
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (${MESSAGES_COLUMNS_DDL});

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migración: DBs creadas antes de ADR 0022 §6 tienen el CHECK viejo
    // (solo user/assistant) y rechazarían un INSERT con role 'tool'. La
    // reconstruimos en sitio. No-op en DBs nuevas (ya traen 'tool').
    this.migrateRoleCheck();

    // Índices al final — tras la migración, para que queden sobre la tabla
    // definitiva (la reconstrucción descarta los índices de la tabla vieja).
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_pending
        ON messages(timestamp) WHERE synced_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_messages_user_time
        ON messages(user_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_messages_time
        ON messages(timestamp);
    `);
  }

  /**
   * Amplía el CHECK del rol para admitir `'tool'` en DBs ya existentes
   * (ADR 0022 §6). SQLite no permite alterar un CHECK in-place, así que se
   * reconstruye la tabla: rename → create nueva → copy → drop. Idempotente:
   * si el CHECK ya incluye `'tool'` (DB nueva o ya migrada), no hace nada.
   */
  private migrateRoleCheck(): void {
    const row = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'`)
      .get() as { sql: string } | undefined;
    if (row === undefined || row.sql.includes("'tool'")) return;

    this.logger?.info('migrando schema de memoria: el rol ahora admite turnos tool (ADR 0022)');
    const migrate = this.db.transaction(() => {
      this.db.exec(`ALTER TABLE messages RENAME TO messages_old;`);
      this.db.exec(`CREATE TABLE messages (${MESSAGES_COLUMNS_DDL});`);
      this.db.exec(
        `INSERT INTO messages (id, user_id, role, text, timestamp, metadata, synced_at)
         SELECT id, user_id, role, text, timestamp, metadata, synced_at FROM messages_old;`,
      );
      this.db.exec(`DROP TABLE messages_old;`);
    });
    migrate();
  }
}

/**
 * Devuelve la metadata de un turno `tool` con la salida recortada a
 * `MAX_TOOL_OUTPUT_CHARS` si la pasaba. No modifica el objeto recibido.
 */
function capToolOutput(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (metadata?.kind !== 'tool') return metadata;
  const result = metadata.result;
  if (typeof result !== 'object' || result === null) return metadata;
  const output = (result as { output?: unknown }).output;
  if (typeof output !== 'string' || output.length <= MAX_TOOL_OUTPUT_CHARS) return metadata;
  const missing = output.length - MAX_TOOL_OUTPUT_CHARS;
  return {
    ...metadata,
    result: {
      ...result,
      output: `${output.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…[recortado: faltan ${String(missing)} caracteres]`,
    },
  };
}

/** Un `LIMIT` que SQLite acepta y que pide algo: entero y positivo. */
function isUsableLimit(limit: number): boolean {
  return Number.isSafeInteger(limit) && limit > 0;
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
