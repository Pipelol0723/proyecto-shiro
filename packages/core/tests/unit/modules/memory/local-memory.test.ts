/**
 * Tests del LocalMemory (WAL en SQLite).
 *
 * Cada test crea su propia DB `:memory:` para aislamiento total.
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { LocalMemory } from '../../../../src/modules/memory/local-memory.js';
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

    it('persiste el role tal cual (user y assistant)', () => {
      memory.save(makeEntry({ id: 'u', role: 'user', timestamp: '2026-05-29T12:00:00.000Z' }));
      memory.save(makeEntry({ id: 'a', role: 'assistant', timestamp: '2026-05-29T12:00:01.000Z' }));
      const pending = memory.getPending();
      expect(pending.map((e) => e.role)).toEqual(['user', 'assistant']);
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
