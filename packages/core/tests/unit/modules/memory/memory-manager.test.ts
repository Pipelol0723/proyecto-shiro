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
import { LettaMemory, type LettaClientLike } from '../../../../src/modules/memory/letta-memory.js';
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

/** Cliente SDK falso (no toca red). Métodos benignos por defecto. */
function stubClient(): LettaClientLike {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', version: 'test' }),
    agents: {
      create: vi.fn().mockResolvedValue({ id: 'agent-provisioned' }),
      retrieve: vi.fn().mockResolvedValue({ id: 'x' }),
      passages: {
        create: vi.fn().mockResolvedValue([]),
        list: vi.fn().mockResolvedValue([]),
        search: vi.fn().mockResolvedValue({ count: 0, results: [] }),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

/** LettaMemory real con cliente SDK stub. Los tests espían sus métodos. */
function makeLetta(
  lettaConfig: { base_url: string; agent_id: string } = {
    base_url: 'http://localhost:8283',
    agent_id: 'test-agent',
  },
): LettaMemory {
  return new LettaMemory(lettaConfig, makeDeps(), stubClient());
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

  it('acepta letta.agent_id vacío (modo auto-provisión)', () => {
    const result = MemoryManagerConfigSchema.parse({ letta: {} });
    expect(result.letta.agent_id).toBe('');
  });
});

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let local: LocalMemory;
  let letta: LettaMemory;

  beforeEach(() => {
    local = new LocalMemory({ dbPath: ':memory:' });
    letta = makeLetta();
    manager = new MemoryManager(BASE_CONFIG, makeDeps(), { local, letta });
  });

  afterEach(async () => {
    await manager.stop();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('lanza MemoryManagerError si config inválida', () => {
      expect(
        () =>
          new MemoryManager({ letta: { base_url: 'no-es-url' } }, makeDeps(), {
            local,
            letta,
          }),
      ).toThrow(MemoryManagerError);
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
      // El push falló pero Letta sigue "up": el estado lo decide el ping, no
      // un push lento (cold-start de embeddings). Ver ADR 0018.
      expect(manager.isLettaUp()).toBe(true);
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

    it('si Letta falla durante un read, devuelve [] sin lanzar (no marca down)', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      vi.spyOn(letta, 'getRecent').mockRejectedValue(new Error('500'));
      await manager.runDrainerOnce();
      expect(manager.isLettaUp()).toBe(true);

      const result = await manager.getRecent(USER, 5);
      expect(result).toEqual([]);
      // Un read fallido no tumba el estado: lo decide el ping (checkLetta).
      expect(manager.isLettaUp()).toBe(true);
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
      // El batch se cortó pero Letta sigue "up": lo decide el ping.
      expect(manager.isLettaUp()).toBe(true);
    });
  });

  describe('provisión del agente (ADR 0018)', () => {
    function makeManager(localDb: LocalMemory, lettaInst: LettaMemory): MemoryManager {
      return new MemoryManager(
        { ...BASE_CONFIG, letta: { base_url: 'http://localhost:8283', agent_id: '' } },
        makeDeps(),
        { local: localDb, letta: lettaInst },
      );
    }

    it('provisiona y persiste el id cuando agent_id está vacío', async () => {
      const local2 = new LocalMemory({ dbPath: ':memory:' });
      const letta2 = makeLetta({ base_url: 'http://localhost:8283', agent_id: '' });
      vi.spyOn(letta2, 'ping').mockResolvedValue(true);
      const provisionSpy = vi.spyOn(letta2, 'provisionAgent').mockResolvedValue('agent-new');
      const setIdSpy = vi.spyOn(letta2, 'setAgentId');
      const mgr = makeManager(local2, letta2);

      await mgr.runDrainerOnce(); // checkLetta → ensureAgent → provisión

      expect(provisionSpy).toHaveBeenCalledOnce();
      expect(setIdSpy).toHaveBeenCalledWith('agent-new');
      expect(local2.getMeta('letta_agent_id')).toBe('agent-new');
      expect(mgr.isLettaUp()).toBe(true);
      await mgr.stop();
    });

    it('reutiliza el agente persistido si todavía existe', async () => {
      const local2 = new LocalMemory({ dbPath: ':memory:' });
      local2.setMeta('letta_agent_id', 'agent-stored');
      const letta2 = makeLetta({ base_url: 'http://localhost:8283', agent_id: '' });
      vi.spyOn(letta2, 'ping').mockResolvedValue(true);
      vi.spyOn(letta2, 'agentExists').mockResolvedValue(true);
      const provisionSpy = vi.spyOn(letta2, 'provisionAgent');
      const setIdSpy = vi.spyOn(letta2, 'setAgentId');
      const mgr = makeManager(local2, letta2);

      await mgr.runDrainerOnce();

      expect(provisionSpy).not.toHaveBeenCalled();
      expect(setIdSpy).toHaveBeenCalledWith('agent-stored');
      await mgr.stop();
    });

    it('re-provisiona si el agente persistido ya no existe', async () => {
      const local2 = new LocalMemory({ dbPath: ':memory:' });
      local2.setMeta('letta_agent_id', 'agent-gone');
      const letta2 = makeLetta({ base_url: 'http://localhost:8283', agent_id: '' });
      vi.spyOn(letta2, 'ping').mockResolvedValue(true);
      vi.spyOn(letta2, 'agentExists').mockResolvedValue(false);
      const provisionSpy = vi.spyOn(letta2, 'provisionAgent').mockResolvedValue('agent-fresh');
      const mgr = makeManager(local2, letta2);

      await mgr.runDrainerOnce();

      expect(provisionSpy).toHaveBeenCalledOnce();
      expect(local2.getMeta('letta_agent_id')).toBe('agent-fresh');
      await mgr.stop();
    });

    it('usa agent_id de la config como override sin provisionar', async () => {
      vi.spyOn(letta, 'ping').mockResolvedValue(true);
      const provisionSpy = vi.spyOn(letta, 'provisionAgent');
      const setIdSpy = vi.spyOn(letta, 'setAgentId');

      await manager.runDrainerOnce();

      expect(provisionSpy).not.toHaveBeenCalled();
      expect(setIdSpy).toHaveBeenCalledWith('test-agent');
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
