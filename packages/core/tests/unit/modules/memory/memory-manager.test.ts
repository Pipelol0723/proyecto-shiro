/**
 * Tests del MemoryManager.
 *
 * Estrategia: LocalMemory real con DB `:memory:` (verifica que el WAL
 * funciona de verdad), LettaMemory mockeado con `vi.fn` por método
 * (controlamos qué responde Letta sin tocar red).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryManager,
  MemoryManagerConfigSchema,
  MemoryManagerError,
} from '../../../../src/modules/memory/memory-manager.js';
import { LocalMemory } from '../../../../src/modules/memory/local-memory.js';
import { LettaMemory } from '../../../../src/modules/memory/letta-memory.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import type { MemoryEntry } from '../../../../src/interfaces/IMemoryModule.js';

const USER = 'pipe';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return {
    logger,
    bus: {
      emit: vi.fn(),
      on: vi.fn(),
    } as unknown as ModuleDeps['bus'],
  };
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: overrides.id ?? 'uuid-1',
    role: overrides.role ?? 'user',
    text: overrides.text ?? 'hola',
    timestamp: overrides.timestamp ?? '2026-05-29T12:00:00.000Z',
    userId: overrides.userId ?? USER,
    ...(overrides.metadata !== undefined ? { metadata: overrides.metadata } : {}),
  };
}

/**
 * Crea un LettaMemory con fetch mockeado para no tocar red. Devuelve el
 * cliente y el `fetchMock` para que cada test controle las respuestas.
 */
function makeLettaWithMockedFetch(): {
  letta: LettaMemory;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
} {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  const letta = new LettaMemory(
    { base_url: 'http://localhost:8283', agent_id: 'test-agent' },
    makeDeps(),
  );
  return { letta, fetchMock };
}

const BASE_CONFIG = {
  user_id: USER,
  letta: {
    base_url: 'http://localhost:8283',
    agent_id: 'test-agent',
  },
  local: { db_path: ':memory:' },
  drainer: { interval_ms: 60_000, batch_size: 10 },
};

describe('MemoryManagerConfigSchema', () => {
  it('aplica defaults para user_id, local, drainer', () => {
    const result = MemoryManagerConfigSchema.parse({
      letta: { agent_id: 'a' },
    });
    expect(result.user_id).toBe('default');
    expect(result.local.db_path).toBe('./data/memory.db');
    expect(result.drainer.interval_ms).toBe(5_000);
    expect(result.drainer.batch_size).toBe(100);
  });

  it('rechaza si falta letta.agent_id', () => {
    expect(() => MemoryManagerConfigSchema.parse({ letta: {} })).toThrow();
  });
});

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let local: LocalMemory;
  let letta: LettaMemory;

  beforeEach(() => {
    local = new LocalMemory({ dbPath: ':memory:' });
    const made = makeLettaWithMockedFetch();
    letta = made.letta;
    manager = new MemoryManager(BASE_CONFIG, makeDeps(), { local, letta });
  });

  afterEach(async () => {
    await manager.stop();
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('lanza MemoryManagerError si config inválida', () => {
      expect(() => new MemoryManager({ letta: {} }, makeDeps())).toThrow(MemoryManagerError);
    });

    it('expone id determinista por user_id', () => {
      expect(manager.id).toBe(`memory:manager:${USER}`);
    });

    it('arranca con lettaUp=false antes de start()', () => {
      expect(manager.isLettaUp()).toBe(false);
    });
  });

  describe('save', () => {
    it('siempre persiste a LocalMemory aunque Letta esté down', async () => {
      // lettaUp = false (no se llamó start()).
      await manager.save(makeEntry({ id: 'x' }));
      expect(local.pendingCount()).toBe(1);
    });

    it('si Letta está arriba, hace push inmediato y marca synced', async () => {
      // Forzar lettaUp=true: stub del ping.
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      const saveSpy = vi.spyOn(letta, 'save').mockResolvedValue();
      await manager.runDrainerOnce(); // checkLetta dentro
      expect(manager.isLettaUp()).toBe(true);

      await manager.save(makeEntry({ id: 'sync-me' }));

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(local.pendingCount()).toBe(0);
    });

    it('si el push inmediato a Letta falla, queda en el WAL como pendiente', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      vi.spyOn(letta, 'save').mockRejectedValue(new Error('network'));
      await manager.runDrainerOnce();

      await manager.save(makeEntry({ id: 'stuck' }));

      expect(local.pendingCount()).toBe(1);
      expect(manager.isLettaUp()).toBe(false);
    });
  });

  describe('getRecent / searchSemantic', () => {
    it('devuelve [] sin llamar a Letta cuando lettaUp=false', async () => {
      const recentSpy = vi.spyOn(letta, 'getRecent');
      const searchSpy = vi.spyOn(letta, 'searchSemantic');

      expect(await manager.getRecent(USER, 5)).toEqual([]);
      expect(await manager.searchSemantic('q', USER, 5)).toEqual([]);

      expect(recentSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
    });

    it('delega a Letta cuando está arriba', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      const recentSpy = vi
        .spyOn(letta, 'getRecent')
        .mockResolvedValue([makeEntry({ id: 'from-letta' })]);
      const searchSpy = vi
        .spyOn(letta, 'searchSemantic')
        .mockResolvedValue([makeEntry({ id: 'semantic' })]);
      await manager.runDrainerOnce();

      const recent = await manager.getRecent(USER, 5);
      expect(recentSpy).toHaveBeenCalledWith(USER, 5);
      expect(recent[0]?.id).toBe('from-letta');

      const semantic = await manager.searchSemantic('query', USER, 3);
      expect(searchSpy).toHaveBeenCalledWith('query', USER, 3);
      expect(semantic[0]?.id).toBe('semantic');
    });

    it('si Letta falla durante un read, marca down y devuelve [] sin lanzar', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      vi.spyOn(letta, 'getRecent').mockRejectedValue(new Error('500'));
      await manager.runDrainerOnce();
      expect(manager.isLettaUp()).toBe(true);

      const result = await manager.getRecent(USER, 5);
      expect(result).toEqual([]);
      expect(manager.isLettaUp()).toBe(false);
    });
  });

  describe('clear', () => {
    it('borra siempre en local', async () => {
      await manager.save(makeEntry({ id: 'a' }));
      await manager.clear(USER);
      expect(local.pendingCount()).toBe(0);
    });

    it('si Letta está arriba también borra allí', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      const clearSpy = vi.spyOn(letta, 'clear').mockResolvedValue();
      await manager.runDrainerOnce();

      await manager.clear(USER);
      expect(clearSpy).toHaveBeenCalledWith(USER);
    });

    it('si Letta está down, solo borra local (no lanza)', async () => {
      const clearSpy = vi.spyOn(letta, 'clear');
      await manager.save(makeEntry({ id: 'a' }));

      await manager.clear(USER);

      expect(local.pendingCount()).toBe(0);
      expect(clearSpy).not.toHaveBeenCalled();
    });
  });

  describe('drainer', () => {
    it('drena entradas pendientes cuando Letta vuelve arriba', async () => {
      // Fase 1: Letta down, acumulamos turnos.
      vi.spyOn(letta, 'ping').mockResolvedValueOnce(false);
      vi.spyOn(letta, 'save').mockResolvedValue();
      await manager.runDrainerOnce();
      await manager.save(makeEntry({ id: 't1', timestamp: '2026-05-29T12:00:00.000Z' }));
      await manager.save(makeEntry({ id: 't2', timestamp: '2026-05-29T12:01:00.000Z' }));
      await manager.save(makeEntry({ id: 't3', timestamp: '2026-05-29T12:02:00.000Z' }));
      expect(local.pendingCount()).toBe(3);

      // Fase 2: Letta vuelve. Drenamos.
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      await manager.runDrainerOnce();

      expect(local.pendingCount()).toBe(0);
    });

    it('drena en orden cronológico (más antiguo primero)', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      const saveSpy = vi.spyOn(letta, 'save').mockResolvedValue();
      await manager.runDrainerOnce();

      // Guardamos en orden NO-cronológico — el WAL los ordena por timestamp.
      // Hacemos save manualmente al local porque manager.save haría push inmediato.
      local.save(makeEntry({ id: 'b', timestamp: '2026-05-29T12:01:00.000Z' }));
      local.save(makeEntry({ id: 'a', timestamp: '2026-05-29T12:00:00.000Z' }));
      local.save(makeEntry({ id: 'c', timestamp: '2026-05-29T12:02:00.000Z' }));

      await manager.runDrainerOnce();

      const order = saveSpy.mock.calls.map((c) => c[0].id);
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('si Letta falla a mitad del batch, corta y reintenta luego', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      const saveSpy = vi
        .spyOn(letta, 'save')
        .mockResolvedValueOnce(undefined) // t1 OK
        .mockRejectedValueOnce(new Error('boom')) // t2 falla
        .mockResolvedValue(undefined); // resto OK si llega
      await manager.runDrainerOnce();

      local.save(makeEntry({ id: 't1', timestamp: '2026-05-29T12:00:00.000Z' }));
      local.save(makeEntry({ id: 't2', timestamp: '2026-05-29T12:01:00.000Z' }));
      local.save(makeEntry({ id: 't3', timestamp: '2026-05-29T12:02:00.000Z' }));

      await manager.runDrainerOnce();

      // t1 drenó, t2 falló (cortamos), t3 no se intentó.
      expect(saveSpy).toHaveBeenCalledTimes(2);
      expect(local.pendingCount()).toBe(2); // t2 y t3 siguen pendientes
      expect(manager.isLettaUp()).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('start() arranca el drainer y stop() lo para', async () => {
      vi.useFakeTimers();
      vi.spyOn(letta, 'ping').mockResolvedValue(false);

      await manager.start();
      // El timer está activo.
      const beforeStop = vi.getTimerCount();
      expect(beforeStop).toBeGreaterThanOrEqual(1);

      await manager.stop();
      // Timer limpio.
      expect(vi.getTimerCount()).toBeLessThan(beforeStop);

      vi.useRealTimers();
    });

    it('stop() es idempotente', async () => {
      await manager.stop();
      await expect(manager.stop()).resolves.toBeUndefined();
    });

    it('start() tras stop() lanza', async () => {
      await manager.stop();
      await expect(manager.start()).rejects.toThrow(MemoryManagerError);
    });
  });
});
