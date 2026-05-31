/**
 * Tests de LettaMemory — cliente del servidor Letta sobre el SDK oficial
 * (ver ADR 0018).
 *
 * Inyectamos un `LettaClientLike` falso (vi.fn por método) en el
 * constructor; no tocamos red ni el SDK real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LettaMemory,
  LettaMemoryConfigSchema,
  LettaMemoryError,
  type LettaClientLike,
} from '../../../../src/modules/memory/letta-memory.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import type { MemoryEntry } from '../../../../src/interfaces/IMemoryModule.js';

const AGENT = 'agent-test';
const USER = 'pipe';
const BASE = 'http://localhost:8283';
const BASE_CONFIG = { base_url: BASE, agent_id: AGENT };

function makeDeps(): ModuleDeps {
  const logger = new Logger();
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

/** Cliente SDK falso con un vi.fn por método. */
function makeClient() {
  const health = vi.fn();
  const create = vi.fn();
  const retrieve = vi.fn();
  const pCreate = vi.fn();
  const pList = vi.fn();
  const pSearch = vi.fn();
  const pDelete = vi.fn();
  const client = {
    health,
    agents: {
      create,
      retrieve,
      passages: { create: pCreate, list: pList, search: pSearch, delete: pDelete },
    },
  } as unknown as LettaClientLike;
  return { client, health, create, retrieve, pCreate, pList, pSearch, pDelete };
}

describe('LettaMemoryConfigSchema', () => {
  it('aplica defaults (base_url, timeout, embedding config de Ollama)', () => {
    const result = LettaMemoryConfigSchema.parse({ agent_id: AGENT });
    expect(result.base_url).toBe(BASE);
    expect(result.timeout_ms).toBe(5_000);
    expect(result.password).toBeUndefined();
    expect(result.model).toBe('ollama/qwen2.5:3b');
    expect(result.embedding_endpoint).toBe('http://host.docker.internal:11434/v1');
    expect(result.embedding_model).toBe('mxbai-embed-large');
    expect(result.embedding_dim).toBe(1024);
    expect(result.context_window_limit).toBe(16_000);
    expect(result.agent_name).toBe('shiro-memory');
  });

  it('permite agent_id vacío (modo auto-provisión, ver MemoryManager)', () => {
    const result = LettaMemoryConfigSchema.parse({});
    expect(result.agent_id).toBe('');
  });

  it('rechaza base_url malformada', () => {
    expect(() =>
      LettaMemoryConfigSchema.parse({ agent_id: AGENT, base_url: 'no-es-url' }),
    ).toThrow();
  });
});

describe('LettaMemory', () => {
  let mock: ReturnType<typeof makeClient>;
  let memory: LettaMemory;

  beforeEach(() => {
    mock = makeClient();
    memory = new LettaMemory(BASE_CONFIG, makeDeps(), mock.client);
  });

  describe('constructor', () => {
    it('lanza LettaMemoryError si la config no parsea', () => {
      expect(() => new LettaMemory({ base_url: 'no-es-url' }, makeDeps(), mock.client)).toThrow(
        LettaMemoryError,
      );
    });

    it('expone un id estable', () => {
      expect(memory.id).toBe('memory:letta');
    });

    it('toma el agent_id de la config como agente activo', () => {
      expect(memory.getAgentId()).toBe(AGENT);
    });
  });

  describe('ping', () => {
    it('devuelve true si health() resuelve', async () => {
      mock.health.mockResolvedValueOnce({ status: 'ok', version: '1.12.0' });
      await expect(memory.ping()).resolves.toBe(true);
      expect(mock.health).toHaveBeenCalledOnce();
    });

    it('devuelve false si health() rechaza (server caído)', async () => {
      mock.health.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(memory.ping()).resolves.toBe(false);
    });
  });

  describe('provisionAgent', () => {
    it('crea el agente con embedding_config explícito y devuelve su id', async () => {
      mock.create.mockResolvedValueOnce({ id: 'agent-nuevo' });
      const id = await memory.provisionAgent();
      expect(id).toBe('agent-nuevo');
      const body = mock.create.mock.calls[0]?.[0] as {
        model: string;
        name: string;
        context_window_limit: number;
        embedding_config: {
          embedding_endpoint: string;
          embedding_model: string;
          embedding_dim: number;
        };
      };
      expect(body.model).toBe('ollama/qwen2.5:3b');
      expect(body.name).toBe('shiro-memory');
      expect(body.context_window_limit).toBe(16_000);
      expect(body.embedding_config.embedding_endpoint).toBe('http://host.docker.internal:11434/v1');
      expect(body.embedding_config.embedding_model).toBe('mxbai-embed-large');
      expect(body.embedding_config.embedding_dim).toBe(1024);
    });
  });

  describe('agentExists', () => {
    it('true si retrieve resuelve', async () => {
      mock.retrieve.mockResolvedValueOnce({ id: AGENT });
      await expect(memory.agentExists(AGENT)).resolves.toBe(true);
    });

    it('false si retrieve da 404', async () => {
      mock.retrieve.mockRejectedValueOnce({ status: 404 });
      await expect(memory.agentExists(AGENT)).resolves.toBe(false);
    });

    it('propaga (no asume inexistente) si el error no es 404', async () => {
      mock.retrieve.mockRejectedValueOnce({ status: 500 });
      await expect(memory.agentExists(AGENT)).rejects.toMatchObject({
        name: 'LettaMemoryError',
        status: 500,
      });
    });
  });

  describe('save', () => {
    it('inserta el passage con text, created_at y tags estructurados', async () => {
      mock.pCreate.mockResolvedValueOnce([{ id: 'letta-id-1', text: 'hola tú' }]);
      await memory.save(makeEntry({ id: 'uuid-x', role: 'assistant', text: 'hola tú' }));

      expect(mock.pCreate).toHaveBeenCalledWith(AGENT, {
        text: 'hola tú',
        created_at: '2026-05-29T12:00:00.000Z',
        tags: ['shiro:id:uuid-x', 'shiro:role:assistant'],
      });
    });

    it('propaga el error del SDK si el insert falla', async () => {
      mock.pCreate.mockRejectedValueOnce(new Error('boom'));
      await expect(memory.save(makeEntry())).rejects.toThrow('boom');
    });

    it('lanza si no hay agente provisionado todavía', async () => {
      const noAgent = new LettaMemory({ base_url: BASE, agent_id: '' }, makeDeps(), mock.client);
      await expect(noAgent.save(makeEntry())).rejects.toMatchObject({
        name: 'LettaMemoryError',
      });
      expect(mock.pCreate).not.toHaveBeenCalled();
    });
  });

  describe('getRecent', () => {
    it('lista con ascending=false y devuelve en orden cronológico ASC', async () => {
      // Letta devuelve más reciente primero; nosotros reverse → ASC.
      mock.pList.mockResolvedValueOnce([
        {
          id: 'p2',
          text: 'segundo',
          created_at: '2026-05-29T12:01:00.000Z',
          tags: ['shiro:id:uuid-2', 'shiro:role:assistant'],
        },
        {
          id: 'p1',
          text: 'primero',
          created_at: '2026-05-29T12:00:00.000Z',
          tags: ['shiro:id:uuid-1', 'shiro:role:user'],
        },
      ]);

      const entries = await memory.getRecent(USER, 10);

      expect(mock.pList).toHaveBeenCalledWith(AGENT, { limit: 10, ascending: false });
      expect(entries.map((e) => e.id)).toEqual(['uuid-1', 'uuid-2']);
      expect(entries[0]?.role).toBe('user');
      expect(entries[1]?.role).toBe('assistant');
      expect(entries[0]?.text).toBe('primero');
    });

    it('si el passage no tiene tags shiro, usa el id de Letta y role user', async () => {
      mock.pList.mockResolvedValueOnce([
        { id: 'letta-foo', text: 'huérfano', created_at: '2026-05-29T12:00:00.000Z' },
      ]);
      const [entry] = await memory.getRecent(USER, 1);
      expect(entry?.id).toBe('letta-foo');
      expect(entry?.role).toBe('user');
    });
  });

  describe('searchSemantic', () => {
    it('busca con query y top_k y normaliza content/timestamp', async () => {
      mock.pSearch.mockResolvedValueOnce({
        count: 1,
        results: [
          {
            id: 'p-sem',
            content: 'algo semánticamente cercano',
            timestamp: '2026-05-29T11:00:00.000Z',
            tags: ['shiro:id:uuid-sem', 'shiro:role:assistant'],
          },
        ],
      });

      const entries = await memory.searchSemantic('proyecto', USER, 3);

      expect(mock.pSearch).toHaveBeenCalledWith(AGENT, { query: 'proyecto', top_k: 3 });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe('uuid-sem');
      expect(entries[0]?.text).toBe('algo semánticamente cercano');
      expect(entries[0]?.role).toBe('assistant');
    });
  });

  describe('clear', () => {
    it('itera list → delete hasta vaciar', async () => {
      mock.pList
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]) // 1ª list
        .mockResolvedValueOnce([]); // 2ª list → corta
      mock.pDelete.mockResolvedValue(undefined);

      await memory.clear(USER);

      expect(mock.pDelete).toHaveBeenCalledTimes(2);
      expect(mock.pDelete).toHaveBeenNthCalledWith(1, 'a', { agent_id: AGENT });
      expect(mock.pDelete).toHaveBeenNthCalledWith(2, 'b', { agent_id: AGENT });
    });

    it('si list devuelve vacío de entrada, no borra nada', async () => {
      mock.pList.mockResolvedValueOnce([]);
      await memory.clear(USER);
      expect(mock.pDelete).not.toHaveBeenCalled();
    });

    it('propaga si un delete falla', async () => {
      mock.pList.mockResolvedValueOnce([{ id: 'a' }]);
      mock.pDelete.mockRejectedValueOnce(new Error('fallo delete'));
      await expect(memory.clear(USER)).rejects.toThrow('fallo delete');
    });

    it('corta (no loop infinito) si los passages no traen id', async () => {
      mock.pList.mockResolvedValue([{ text: 'sin id' }]);
      await expect(memory.clear(USER)).rejects.toMatchObject({ name: 'LettaMemoryError' });
      expect(mock.pDelete).not.toHaveBeenCalled();
    });
  });
});
