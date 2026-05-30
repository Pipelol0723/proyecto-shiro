/**
 * Tests de LettaMemory — cliente HTTP del servidor Letta.
 *
 * `fetch` global se mockea con `vi.fn<typeof fetch>()` por test. No
 * tocamos red real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LettaMemory,
  LettaMemoryConfigSchema,
  LettaMemoryError,
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

/** Construye una Response sintética. */
function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number, statusText = ''): Response {
  // status 204/304 no permiten body — Node es estricto y lanza si se pasa string vacío.
  const body = status === 204 || status === 304 ? null : '';
  return new Response(body, { status, statusText });
}

describe('LettaMemoryConfigSchema', () => {
  it('aplica defaults para base_url y timeout', () => {
    const result = LettaMemoryConfigSchema.parse({ agent_id: AGENT });
    expect(result.base_url).toBe(BASE);
    expect(result.timeout_ms).toBe(5_000);
    expect(result.password).toBeUndefined();
  });

  it('permite agent_id vacío (modo deshabilitado, ver MemoryManager)', () => {
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
  let memory: LettaMemory;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    memory = new LettaMemory(BASE_CONFIG, makeDeps());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('lanza LettaMemoryError si la config no parsea', () => {
      expect(() => new LettaMemory({ base_url: 'no-es-url' }, makeDeps())).toThrow(
        LettaMemoryError,
      );
    });

    it('expone un id determinista derivado del agent_id', () => {
      expect(memory.id).toBe(`memory:letta:${AGENT}`);
    });
  });

  describe('ping', () => {
    it('devuelve true si /v1/health/check responde 2xx', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(200));
      await expect(memory.ping()).resolves.toBe(true);
      const call = fetchMock.mock.calls[0];
      expect(call?.[0]).toBe(`${BASE}/v1/health/check`);
      expect(call?.[1]?.method).toBe('GET');
    });

    it('devuelve false si el server responde 5xx', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(503));
      await expect(memory.ping()).resolves.toBe(false);
    });

    it('devuelve false si fetch lanza (red caída)', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('network'));
      await expect(memory.ping()).resolves.toBe(false);
    });

    it('devuelve false sin tocar fetch si agent_id está vacío', async () => {
      const disabled = new LettaMemory({ base_url: BASE, agent_id: '' }, makeDeps());
      await expect(disabled.ping()).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('auth Bearer', () => {
    it('incluye Authorization si la config tiene password', async () => {
      const withPass = new LettaMemory({ ...BASE_CONFIG, password: 'sekret' }, makeDeps());
      fetchMock.mockResolvedValueOnce(emptyResponse(200));
      await withPass.ping();
      const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer sekret');
    });

    it('omite Authorization si no hay password', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(200));
      await memory.ping();
      const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    });
  });

  describe('save', () => {
    it('hace POST con text, created_at y tags estructurados', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'letta-id-1' }));
      await memory.save(makeEntry({ id: 'uuid-x', role: 'assistant', text: 'hola tú' }));

      const call = fetchMock.mock.calls[0];
      expect(call?.[0]).toBe(`${BASE}/v1/agents/${AGENT}/archival-memory`);
      expect(call?.[1]?.method).toBe('POST');
      const body = JSON.parse(call?.[1]?.body as string) as {
        text: string;
        created_at: string;
        tags: string[];
      };
      expect(body.text).toBe('hola tú');
      expect(body.created_at).toBe('2026-05-29T12:00:00.000Z');
      expect(body.tags).toEqual(['shiro:id:uuid-x', 'shiro:role:assistant']);
    });

    it('lanza LettaMemoryError con status si Letta responde no-ok', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(500, 'server fail'));
      await expect(memory.save(makeEntry())).rejects.toMatchObject({
        name: 'LettaMemoryError',
        status: 500,
      });
    });
  });

  describe('getRecent', () => {
    it('lista con ascending=false y devuelve en orden cronológico ASC', async () => {
      // Letta devuelve más reciente primero; nosotros reverse → ASC.
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
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
        ]),
      );

      const entries = await memory.getRecent(USER, 10);

      const [url] = fetchMock.mock.calls[0] ?? [];
      expect(url).toContain(`/v1/agents/${AGENT}/archival-memory?`);
      expect(url).toContain('limit=10');
      expect(url).toContain('ascending=false');

      expect(entries.map((e) => e.id)).toEqual(['uuid-1', 'uuid-2']);
      expect(entries[0]?.role).toBe('user');
      expect(entries[1]?.role).toBe('assistant');
      expect(entries[0]?.text).toBe('primero');
    });

    it('si el passage no tiene tags shiro, usa el id de Letta y role user por default', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          { id: 'letta-foo', text: 'huérfano', created_at: '2026-05-29T12:00:00.000Z' },
        ]),
      );
      const [entry] = await memory.getRecent(USER, 1);
      expect(entry?.id).toBe('letta-foo');
      expect(entry?.role).toBe('user');
    });

    it('lanza LettaMemoryError si el server responde 404', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(404, 'agent missing'));
      await expect(memory.getRecent(USER, 5)).rejects.toMatchObject({
        name: 'LettaMemoryError',
        status: 404,
      });
    });
  });

  describe('searchSemantic', () => {
    it('hace GET a /archival-memory/search con query y top_k', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          results: [
            {
              id: 'p-sem',
              content: 'algo semánticamente cercano',
              timestamp: '2026-05-29T11:00:00.000Z',
              tags: ['shiro:id:uuid-sem', 'shiro:role:assistant'],
            },
          ],
        }),
      );

      const entries = await memory.searchSemantic('proyecto', USER, 3);

      const [url] = fetchMock.mock.calls[0] ?? [];
      expect(url).toContain(`/v1/agents/${AGENT}/archival-memory/search?`);
      expect(url).toContain('query=proyecto');
      expect(url).toContain('top_k=3');

      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe('uuid-sem');
      expect(entries[0]?.text).toBe('algo semánticamente cercano');
      expect(entries[0]?.role).toBe('assistant');
    });

    it('encode-URI la query para que caracteres especiales no rompan', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ count: 0, results: [] }));
      await memory.searchSemantic('hola & mundo', USER, 1);
      const [url] = fetchMock.mock.calls[0] ?? [];
      expect(url).toContain('query=hola+%26+mundo');
    });
  });

  describe('clear', () => {
    it('itera list → delete hasta vaciar', async () => {
      // 1ª list: 2 passages.
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'a' }, { id: 'b' }]));
      // DELETE a, DELETE b.
      fetchMock.mockResolvedValueOnce(emptyResponse(204));
      fetchMock.mockResolvedValueOnce(emptyResponse(204));
      // 2ª list: vacío → corta el loop.
      fetchMock.mockResolvedValueOnce(jsonResponse([]));

      await memory.clear(USER);

      expect(fetchMock).toHaveBeenCalledTimes(4);
      const methods = fetchMock.mock.calls.map((c) => c[1]?.method);
      expect(methods).toEqual(['GET', 'DELETE', 'DELETE', 'GET']);
    });

    it('si list devuelve vacío de entrada, no hace ningún delete', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));
      await memory.clear(USER);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('propaga LettaMemoryError si un delete falla', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'a' }]));
      fetchMock.mockResolvedValueOnce(emptyResponse(500, 'fallo'));
      await expect(memory.clear(USER)).rejects.toMatchObject({
        name: 'LettaMemoryError',
        status: 500,
      });
    });
  });
});
