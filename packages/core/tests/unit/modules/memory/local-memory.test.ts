/**
 * Tests del LocalMemory (WAL en SQLite).
 *
 * Cada test crea su propia DB `:memory:` para aislamiento total.
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  LocalMemory,
  MAX_TOOL_OUTPUT_CHARS,
  SCHEMA_VERSION,
  normalizeNativeBinding,
} from '../../../../src/modules/memory/local-memory.js';
import type { MemoryEntry } from '../../../../src/interfaces/IMemoryModule.js';

const USER = 'pipe';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: overrides.id ?? 'id-1',
    role: overrides.role ?? 'user',
    text: overrides.text ?? 'hola',
    timestamp: overrides.timestamp ?? '2026-05-29T12:00:00.000Z',
    userId: overrides.userId ?? USER,
    ...(overrides.metadata !== undefined ? { metadata: overrides.metadata } : {}),
  };
}

describe('normalizeNativeBinding', () => {
  it('quita el prefijo verbatim de un path con unidad (\\\\?\\D:\\…)', () => {
    expect(normalizeNativeBinding('\\\\?\\D:\\app\\better_sqlite3.node')).toBe(
      'D:\\app\\better_sqlite3.node',
    );
  });

  it('convierte el prefijo verbatim UNC a su forma normal (\\\\?\\UNC\\…)', () => {
    expect(normalizeNativeBinding('\\\\?\\UNC\\servidor\\share\\lib.node')).toBe(
      '\\\\servidor\\share\\lib.node',
    );
  });

  it('deja intactos los paths normales (sin prefijo)', () => {
    expect(normalizeNativeBinding('D:\\app\\better_sqlite3.node')).toBe(
      'D:\\app\\better_sqlite3.node',
    );
    expect(normalizeNativeBinding('/usr/lib/better_sqlite3.node')).toBe(
      '/usr/lib/better_sqlite3.node',
    );
  });

  it('devuelve undefined para vacío/undefined (equivale a no pasar binding)', () => {
    expect(normalizeNativeBinding(undefined)).toBeUndefined();
    expect(normalizeNativeBinding('')).toBeUndefined();
  });
});

describe('LocalMemory', () => {
  let memory: LocalMemory;

  beforeEach(() => {
    memory = new LocalMemory({ dbPath: ':memory:' });
  });

  afterEach(() => {
    memory.close();
  });

  describe('constructor', () => {
    it('arranca con DB vacía (0 pendientes)', () => {
      expect(memory.pendingCount()).toBe(0);
      expect(memory.getPending()).toEqual([]);
    });

    it('crea el directorio padre si no existe (recursivo)', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'shiro-localmem-'));
      const dbPath = join(tmp, 'sub1', 'sub2', 'memory.db');
      try {
        const fresh = new LocalMemory({ dbPath });
        try {
          expect(existsSync(dbPath)).toBe(true);
          expect(statSync(dbPath).isFile()).toBe(true);
        } finally {
          fresh.close();
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('save', () => {
    it('persiste una entrada y la marca como pendiente', () => {
      memory.save(makeEntry());
      expect(memory.pendingCount()).toBe(1);
      const pending = memory.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe('id-1');
      expect(pending[0]?.text).toBe('hola');
    });

    it('persiste metadata serializándola a JSON y recuperándola igual', () => {
      memory.save(
        makeEntry({
          id: 'with-meta',
          metadata: { emotion: 'divertida', tier: 'local', latencyMs: 740 },
        }),
      );
      const [entry] = memory.getPending();
      expect(entry?.metadata).toEqual({
        emotion: 'divertida',
        tier: 'local',
        latencyMs: 740,
      });
    });

    it('omite metadata si el caller no la pasó', () => {
      memory.save(makeEntry({ id: 'no-meta' }));
      const [entry] = memory.getPending();
      expect(entry?.metadata).toBeUndefined();
    });

    it('persiste el role tal cual (user, assistant y tool)', () => {
      memory.save(makeEntry({ id: 'u', role: 'user', timestamp: '2026-05-29T12:00:00.000Z' }));
      memory.save(makeEntry({ id: 'a', role: 'assistant', timestamp: '2026-05-29T12:00:01.000Z' }));
      memory.save(makeEntry({ id: 't', role: 'tool', timestamp: '2026-05-29T12:00:02.000Z' }));
      const pending = memory.getPending();
      expect(pending.map((e) => e.role)).toEqual(['user', 'assistant', 'tool']);
    });

    it('persiste un turno tool con su metadata estructurada (ADR 0022 §6)', () => {
      memory.save(
        makeEntry({
          id: 'tool-1',
          role: 'tool',
          text: 'Ejecuté fs:read con {"path":"a.txt"}',
          metadata: {
            kind: 'tool',
            toolId: 'fs:read',
            toolName: 'fs_read',
            args: { path: 'a.txt' },
            result: { ok: true, output: 'contenido' },
            approved: null,
          },
        }),
      );
      const [entry] = memory.getPending();
      expect(entry?.role).toBe('tool');
      expect(entry?.metadata).toMatchObject({ kind: 'tool', toolId: 'fs:read', approved: null });
    });

    it('lanza si el id se repite (idempotencia respetada por PRIMARY KEY)', () => {
      memory.save(makeEntry({ id: 'dup' }));
      expect(() => memory.save(makeEntry({ id: 'dup' }))).toThrow();
    });
  });

  describe('getPending', () => {
    it('devuelve las pendientes ordenadas por timestamp ASC', () => {
      memory.save(makeEntry({ id: 'b', timestamp: '2026-05-29T12:01:00.000Z' }));
      memory.save(makeEntry({ id: 'a', timestamp: '2026-05-29T12:00:00.000Z' }));
      memory.save(makeEntry({ id: 'c', timestamp: '2026-05-29T12:02:00.000Z' }));
      expect(memory.getPending().map((e) => e.id)).toEqual(['a', 'b', 'c']);
    });

    it('respeta el limit', () => {
      for (let i = 0; i < 5; i += 1) {
        memory.save(
          makeEntry({
            id: `id-${String(i)}`,
            timestamp: `2026-05-29T12:0${String(i)}:00.000Z`,
          }),
        );
      }
      const batch = memory.getPending(2);
      expect(batch).toHaveLength(2);
      expect(batch.map((e) => e.id)).toEqual(['id-0', 'id-1']);
    });

    it('no devuelve entradas ya sincronizadas', () => {
      memory.save(makeEntry({ id: 'a' }));
      memory.save(makeEntry({ id: 'b', timestamp: '2026-05-29T12:01:00.000Z' }));
      memory.markSynced('a');
      const pending = memory.getPending();
      expect(pending.map((e) => e.id)).toEqual(['b']);
    });
  });

  describe('markSynced', () => {
    it('quita la entrada de las pendientes', () => {
      memory.save(makeEntry({ id: 'x' }));
      expect(memory.pendingCount()).toBe(1);
      memory.markSynced('x');
      expect(memory.pendingCount()).toBe(0);
    });

    it('no hace nada si el id no existe', () => {
      memory.save(makeEntry({ id: 'real' }));
      memory.markSynced('ghost');
      expect(memory.pendingCount()).toBe(1);
    });

    it('acepta un syncedAt explícito (útil para tests determinísticos)', () => {
      memory.save(makeEntry({ id: 'x' }));
      memory.markSynced('x', '2026-05-29T13:00:00.000Z');
      // Marcada → no aparece como pendiente.
      expect(memory.getPending()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('borra solo las entradas del userId indicado', () => {
      memory.save(makeEntry({ id: 'mine-1', userId: 'pipe' }));
      memory.save(makeEntry({ id: 'mine-2', userId: 'pipe' }));
      memory.save(makeEntry({ id: 'other-1', userId: 'otra' }));

      memory.clear('pipe');

      const remaining = memory.getPending();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.userId).toBe('otra');
    });

    it('no hace nada si el userId no tiene entradas', () => {
      memory.save(makeEntry({ id: 'one' }));
      memory.clear('nadie');
      expect(memory.pendingCount()).toBe(1);
    });
  });

  describe('flujo WAL realista', () => {
    it('captura turnos durante "Letta caído" y los drena cuando vuelve', () => {
      // Simula 3 turnos guardados mientras Letta no responde.
      memory.save(makeEntry({ id: 't1', timestamp: '2026-05-29T12:00:00.000Z' }));
      memory.save(makeEntry({ id: 't2', timestamp: '2026-05-29T12:00:30.000Z' }));
      memory.save(makeEntry({ id: 't3', timestamp: '2026-05-29T12:01:00.000Z' }));
      expect(memory.pendingCount()).toBe(3);

      // Drainer pide un batch.
      const batch = memory.getPending(10);
      expect(batch.map((e) => e.id)).toEqual(['t1', 't2', 't3']);

      // Letta confirma cada uno; el drainer marca.
      for (const entry of batch) {
        memory.markSynced(entry.id);
      }

      expect(memory.pendingCount()).toBe(0);

      // Un turno más posterior queda pendiente solo él.
      memory.save(makeEntry({ id: 't4', timestamp: '2026-05-29T12:02:00.000Z' }));
      expect(memory.getPending().map((e) => e.id)).toEqual(['t4']);
    });
  });

  describe('migración del CHECK de rol (ADR 0022 §6)', () => {
    it('migra una DB con el CHECK viejo (sin tool) y preserva los datos', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'shiro-mig-'));
      const dbPath = join(tmp, 'memory.db');
      try {
        // Crea una DB con el schema PREVIO a ADR 0022 (CHECK solo
        // user/assistant) y una fila existente.
        const old = new Database(dbPath);
        old.exec(`
          CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
            text TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            metadata TEXT,
            synced_at TEXT
          );
        `);
        old
          .prepare(
            `INSERT INTO messages (id, user_id, role, text, timestamp) VALUES (?, ?, ?, ?, ?)`,
          )
          .run('old-1', USER, 'assistant', 'recuerdo viejo', '2026-05-29T12:00:00.000Z');
        old.close();

        // Al abrir con LocalMemory se migra: ahora admite role 'tool' y la
        // fila vieja sobrevive.
        const migrated = new LocalMemory({ dbPath });
        try {
          expect(() =>
            migrated.save(
              makeEntry({ id: 'tool-1', role: 'tool', timestamp: '2026-05-29T12:01:00.000Z' }),
            ),
          ).not.toThrow();
          const ids = migrated.getPending().map((e) => e.id);
          expect(ids).toContain('old-1');
          expect(ids).toContain('tool-1');
        } finally {
          migrated.close();
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('reabrir una DB ya migrada es idempotente (no vuelve a migrar)', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'shiro-mig2-'));
      const dbPath = join(tmp, 'memory.db');
      try {
        const first = new LocalMemory({ dbPath });
        first.save(makeEntry({ id: 'tool-1', role: 'tool' }));
        first.close();

        const second = new LocalMemory({ dbPath });
        try {
          expect(second.getPending().map((e) => e.id)).toEqual(['tool-1']);
          expect(() => second.save(makeEntry({ id: 'tool-2', role: 'tool' }))).not.toThrow();
        } finally {
          second.close();
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('meta (clave-valor)', () => {
    it('devuelve undefined para una clave inexistente', () => {
      expect(memory.getMeta('letta_agent_id')).toBeUndefined();
    });

    it('persiste y lee un valor', () => {
      memory.setMeta('letta_agent_id', 'agent-123');
      expect(memory.getMeta('letta_agent_id')).toBe('agent-123');
    });

    it('upsert: setMeta sobre una clave existente la sobreescribe', () => {
      memory.setMeta('letta_agent_id', 'agent-viejo');
      memory.setMeta('letta_agent_id', 'agent-nuevo');
      expect(memory.getMeta('letta_agent_id')).toBe('agent-nuevo');
    });
  });
});

/** Ejecuta `run` con la ruta de una DB en un directorio temporal, que se borra después. */
function withTmpDb(run: (dbPath: string) => void): void {
  const tmp = mkdtempSync(join(tmpdir(), 'shiro-schema-'));
  try {
    run(join(tmp, 'memory.db'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Crea una DB como la dejaba el código anterior a P-10: sin `user_version`. */
function createV0Db(dbPath: string, rows: [id: string, role: string, timestamp: string][]): void {
  const old = new Database(dbPath);
  old.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
      text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT,
      synced_at TEXT
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const insert = old.prepare(
    `INSERT INTO messages (id, user_id, role, text, timestamp) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const [id, role, timestamp] of rows) insert.run(id, USER, role, `texto de ${id}`, timestamp);
  old.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run('letta_agent_id', 'agent-1');
  old.close();
}

describe('LocalMemory — esquema versionado (P-10, R-176)', () => {
  it('una DB nueva nace en la versión actual', () => {
    const memory = new LocalMemory({ dbPath: ':memory:' });
    try {
      expect(SCHEMA_VERSION).toBe(1);
      expect(memory.schemaVersion()).toBe(SCHEMA_VERSION);
    } finally {
      memory.close();
    }
  });

  it('una DB v0 con datos pasa a v1, conserva todo y deja una copia de como estaba', () => {
    withTmpDb((dbPath) => {
      createV0Db(dbPath, [
        ['a', 'user', '2026-05-29T12:00:00.000Z'],
        ['b', 'assistant', '2026-05-29T12:00:05.000Z'],
      ]);

      const memory = new LocalMemory({ dbPath });
      try {
        expect(memory.schemaVersion()).toBe(1);
        expect(memory.getPending().map((e) => e.id)).toEqual(['a', 'b']);
        expect(memory.getMeta('letta_agent_id')).toBe('agent-1');
      } finally {
        memory.close();
      }

      const backupPath = `${dbPath}.v0.bak`;
      expect(existsSync(backupPath)).toBe(true);
      const backup = new Database(backupPath, { readonly: true });
      try {
        expect(backup.pragma('user_version', { simple: true })).toBe(0);
        expect(backup.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 2 });
      } finally {
        backup.close();
      }
    });
  });

  it('reabrir una DB ya en v1 no migra ni vuelve a copiar', () => {
    withTmpDb((dbPath) => {
      const first = new LocalMemory({ dbPath });
      first.save(makeEntry({ id: 'x' }));
      first.close();
      // Nació en v1: no había nada anterior que copiar.
      expect(existsSync(`${dbPath}.v0.bak`)).toBe(false);

      const second = new LocalMemory({ dbPath });
      try {
        expect(second.schemaVersion()).toBe(1);
        expect(second.getPending().map((e) => e.id)).toEqual(['x']);
      } finally {
        second.close();
      }
      expect(existsSync(`${dbPath}.v0.bak`)).toBe(false);
    });
  });

  it('una DB v0 sin turnos se versiona sin dejar copia: no hay nada que perder', () => {
    withTmpDb((dbPath) => {
      createV0Db(dbPath, []);
      const memory = new LocalMemory({ dbPath });
      try {
        expect(memory.schemaVersion()).toBe(1);
        expect(memory.getMeta('letta_agent_id')).toBe('agent-1');
      } finally {
        memory.close();
      }
      expect(existsSync(`${dbPath}.v0.bak`)).toBe(false);
    });
  });

  it('una copia anterior no se pisa', () => {
    withTmpDb((dbPath) => {
      createV0Db(dbPath, [['a', 'user', '2026-05-29T12:00:00.000Z']]);
      const marker = new Database(`${dbPath}.v0.bak`);
      marker.exec('CREATE TABLE marca (x INTEGER)');
      marker.close();

      new LocalMemory({ dbPath }).close();

      const backup = new Database(`${dbPath}.v0.bak`, { readonly: true });
      try {
        const tables = backup
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
          .all() as { name: string }[];
        expect(tables.map((t) => t.name)).toEqual(['marca']);
      } finally {
        backup.close();
      }
    });
  });

  it('una DB de una versión posterior no se abre: lo dice en vez de tocarla', () => {
    withTmpDb((dbPath) => {
      const future = new Database(dbPath);
      future.pragma('user_version = 2');
      future.close();

      expect(() => new LocalMemory({ dbPath })).toThrow(/versión 2/);

      const untouched = new Database(dbPath, { readonly: true });
      try {
        expect(untouched.pragma('user_version', { simple: true })).toBe(2);
      } finally {
        untouched.close();
      }
    });
  });
});

describe('LocalMemory — historial reciente (P-10, R-072)', () => {
  let memory: LocalMemory;

  beforeEach(() => {
    memory = new LocalMemory({ dbPath: ':memory:' });
    for (let i = 1; i <= 5; i += 1) {
      memory.save(
        makeEntry({
          id: `m${String(i)}`,
          role: i % 2 === 1 ? 'user' : 'assistant',
          text: `mensaje ${String(i)}`,
          timestamp: `2026-05-29T12:00:0${String(i)}.000Z`,
        }),
      );
    }
    memory.save(
      makeEntry({ id: 'otro', userId: 'otra-persona', timestamp: '2026-05-29T12:00:09.000Z' }),
    );
  });

  afterEach(() => {
    memory.close();
  });

  it('devuelve los últimos N del usuario, del más antiguo al más reciente', () => {
    expect(memory.getRecent(USER, 3).map((e) => e.id)).toEqual(['m3', 'm4', 'm5']);
    expect(memory.getRecent(USER, 3)[0]?.text).toBe('mensaje 3');
  });

  it('da igual que estén sincronizados o pendientes', () => {
    memory.markSynced('m4');
    memory.markSynced('m5');
    expect(memory.getRecent(USER, 3).map((e) => e.id)).toEqual(['m3', 'm4', 'm5']);
  });

  it('excluye la entrada que se le indica sin gastar su hueco', () => {
    expect(memory.getRecent(USER, 3, { excludeId: 'm5' }).map((e) => e.id)).toEqual([
      'm2',
      'm3',
      'm4',
    ]);
  });

  it('no mezcla usuarios', () => {
    expect(memory.getRecent(USER, 50).map((e) => e.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(memory.getRecent('otra-persona', 50).map((e) => e.id)).toEqual(['otro']);
  });

  it('con límite 0, o sin turnos, no devuelve nada', () => {
    expect(memory.getRecent(USER, 0)).toEqual([]);
    expect(memory.getRecent('nadie', 5)).toEqual([]);
  });

  it('a igual marca de tiempo, el orden no baila', () => {
    memory.save(makeEntry({ id: 'z2', timestamp: '2026-05-29T12:00:08.000Z' }));
    memory.save(makeEntry({ id: 'z1', timestamp: '2026-05-29T12:00:08.000Z' }));
    expect(memory.getRecent(USER, 2).map((e) => e.id)).toEqual(['z1', 'z2']);
  });
});

describe('LocalMemory — salida de herramientas acotada (P-10, R-175)', () => {
  let memory: LocalMemory;

  beforeEach(() => {
    memory = new LocalMemory({ dbPath: ':memory:' });
  });

  afterEach(() => {
    memory.close();
  });

  function toolEntry(output: string): MemoryEntry {
    return makeEntry({
      id: 'tool-1',
      role: 'tool',
      text: 'Ejecuté fs:read',
      metadata: {
        kind: 'tool',
        toolId: 'fs:read',
        toolName: 'fs_read',
        args: { path: 'notas.txt' },
        result: { ok: true, output },
        approved: null,
      },
    });
  }

  function storedOutput(): string {
    const [stored] = memory.getPending();
    return (stored?.metadata as { result: { output: string } }).result.output;
  }

  it('recorta la salida larga de un turno tool y dice cuánto quitó', () => {
    const output = `inicio${'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 500)}`;
    memory.save(toolEntry(output));

    const stored = storedOutput();
    expect(stored.length).toBeLessThan(output.length);
    expect(stored.startsWith('inicio')).toBe(true);
    expect(stored).toMatch(/recortado: faltan 506 caracteres/);
  });

  it('una salida que cabe se guarda entera', () => {
    const output = 'y'.repeat(MAX_TOOL_OUTPUT_CHARS);
    memory.save(toolEntry(output));
    expect(storedOutput()).toBe(output);
  });

  it('el resto de la metadata no se toca, ni el objeto que se le pasó', () => {
    const output = 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 10);
    const entry = toolEntry(output);
    memory.save(entry);

    const [stored] = memory.getPending();
    expect(stored?.metadata).toMatchObject({
      kind: 'tool',
      toolId: 'fs:read',
      args: { path: 'notas.txt' },
      approved: null,
    });
    expect((entry.metadata as { result: { output: string } }).result.output).toBe(output);
  });

  it('solo recorta turnos tool: la metadata de los demás se guarda como venga', () => {
    const long = 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 10);
    memory.save(makeEntry({ id: 'u', metadata: { result: { ok: true, output: long } } }));
    expect(storedOutput()).toBe(long);
  });
});
