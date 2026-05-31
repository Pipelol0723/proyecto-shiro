/**
 * Tests del pipeline conversacional real con mocks de los módulos.
 *
 * Valida el flujo: user:message → memory.save (user) → router → memory
 * reads → LLM (con context) → llm:responded → memory.save (assistant)
 * → tts:audio-ended. No hace red — los mocks responden inmediatamente.
 *
 * Ver ADR 0016 (wiring) y ADR 0017 (memoria).
 */

import { describe, expect, it, vi } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import type {
  EventMap,
  IAvatarModule,
  ILLMModule,
  IMemoryModule,
  IRouterModule,
  ISTTModule,
  ITTSModule,
  LLMRequest,
  LLMResponse,
  LLMTier,
  LoadedModules,
  MemoryEntry,
} from '@proyecto-shiro/core';
import { wireConversationFlow } from '../../src/pipeline/conversation-flow.js';

function makeLogger(): Logger {
  return new Logger('error', { module: 'flow-test' });
}

interface RouterMockOptions {
  /** Tier que devuelve. Default 'local'. */
  tier?: LLMTier;
  /** Si true, route() rechaza. */
  fail?: boolean;
}

function makeRouter(opts: RouterMockOptions = {}): IRouterModule & { calls: number } {
  let calls = 0;
  return {
    id: 'router:mock',
    route: async () => {
      calls += 1;
      if (opts.fail === true) throw new Error('router falló');
      await Promise.resolve();
      return opts.tier ?? 'local';
    },
    get calls() {
      return calls;
    },
  };
}

interface LLMMockOptions {
  response?: LLMResponse;
  /** Si true, generate() rechaza. */
  fail?: boolean;
}

function makeLLM(id: string, opts: LLMMockOptions = {}): ILLMModule & { calls: number } {
  let calls = 0;
  return {
    id,
    generate: async () => {
      calls += 1;
      if (opts.fail === true) throw new Error('LLM falló');
      await Promise.resolve();
      return opts.response ?? { text: `${id} responde`, emotion: 'neutral', tokensUsed: 5 };
    },
    get calls() {
      return calls;
    },
  };
}

interface MemoryMockOptions {
  /** Entradas que getRecent devuelve. Default []. */
  recent?: MemoryEntry[];
  /** Entradas que searchSemantic devuelve. Default []. */
  semantic?: MemoryEntry[];
  /** Si true, save() rechaza. */
  saveFails?: boolean;
  /** Si > 0, getRecent espera esos ms antes de resolver. */
  recentDelayMs?: number;
  /** Si > 0, searchSemantic espera esos ms antes de resolver. */
  semanticDelayMs?: number;
}

function makeMemory(opts: MemoryMockOptions = {}): IMemoryModule & {
  saved: MemoryEntry[];
  getRecentCalls: { userId: string; limit: number }[];
  searchCalls: { query: string; userId: string; limit: number }[];
} {
  const saved: MemoryEntry[] = [];
  const getRecentCalls: { userId: string; limit: number }[] = [];
  const searchCalls: { query: string; userId: string; limit: number }[] = [];
  return {
    id: 'memory:mock',
    save: async (entry) => {
      if (opts.saveFails === true) throw new Error('save falló');
      saved.push(entry);
      await Promise.resolve();
    },
    getRecent: async (userId, limit) => {
      getRecentCalls.push({ userId, limit });
      if (opts.recentDelayMs !== undefined && opts.recentDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.recentDelayMs));
      } else {
        await Promise.resolve();
      }
      return opts.recent ?? [];
    },
    searchSemantic: async (query, userId, limit) => {
      searchCalls.push({ query, userId, limit });
      if (opts.semanticDelayMs !== undefined && opts.semanticDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.semanticDelayMs));
      } else {
        await Promise.resolve();
      }
      return opts.semantic ?? [];
    },
    clear: async () => {
      await Promise.resolve();
    },
    get saved() {
      return saved;
    },
    get getRecentCalls() {
      return getRecentCalls;
    },
    get searchCalls() {
      return searchCalls;
    },
  };
}

function makeModules(overrides: Partial<LoadedModules> = {}): LoadedModules {
  return {
    llmLocal: makeLLM('llm:local-mock'),
    llmCloud: makeLLM('llm:cloud-mock'),
    router: makeRouter(),
    stt: { id: 'stt:noop' } as ISTTModule,
    tts: { id: 'tts:noop' } as ITTSModule,
    memory: makeMemory(),
    avatar: { id: 'avatar:noop' } as IAvatarModule,
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('wireConversationFlow', () => {
  it('al recibir user:message emite router:routed → llm:responded', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const modules = makeModules({
      llmLocal: makeLLM('llm:local-mock', {
        response: { text: 'hola tú', emotion: 'divertida', tokensUsed: 12 },
      }),
    });

    const routed: EventMap['router:routed'][] = [];
    const responded: EventMap['llm:responded'][] = [];
    bus.on('router:routed', (p) => {
      routed.push(p);
    });
    bus.on('llm:responded', (p) => {
      responded.push(p);
    });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'u1' });

    expect(routed).toHaveLength(1);
    expect(routed[0]?.tier).toBe('local');

    expect(responded).toHaveLength(1);
    expect(responded[0]?.text).toBe('hola tú');
    expect(responded[0]?.emotion).toBe('divertida');
    expect(responded[0]?.tier).toBe('local');
    expect(responded[0]?.userId).toBe('u1');
    expect(typeof responded[0]?.latencyMs).toBe('number');

    dispose();
  });

  it('cuando el router elige cloud, llama a llmCloud (no a llmLocal)', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const llmLocal = makeLLM('llm:local-mock');
    const llmCloud = makeLLM('llm:cloud-mock');
    const modules = makeModules({
      router: makeRouter({ tier: 'cloud' }),
      llmLocal,
      llmCloud,
    });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'analiza esto', userId: 'u1' });

    expect(llmLocal.calls).toBe(0);
    expect(llmCloud.calls).toBe(1);

    dispose();
  });

  it('si el tier es cloud y el LLM cloud falla, cae a local (no rompe el turno)', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const llmLocal = makeLLM('llm:local-mock', {
      response: { text: 'respondo yo, local', emotion: 'neutral', tokensUsed: 3 },
    });
    const llmCloud = makeLLM('llm:cloud-mock', { fail: true }); // p.ej. sin ANTHROPIC_API_KEY
    const modules = makeModules({ router: makeRouter({ tier: 'cloud' }), llmLocal, llmCloud });

    const responded: EventMap['llm:responded'][] = [];
    bus.on('llm:responded', (p) => {
      responded.push(p);
    });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'tu quien eres?', userId: 'u1' });
    await flushPromises();

    // El cloud se intentó y falló; el local respondió de verdad.
    expect(llmCloud.calls).toBe(1);
    expect(llmLocal.calls).toBe(1);
    expect(responded).toHaveLength(1);
    expect(responded[0]?.text).toBe('respondo yo, local');
    expect(responded[0]?.tier).toBe('local'); // el tier reportado refleja quién respondió
    expect(responded[0]?.text).not.toMatch(/algo sali/i); // NO es el fallback genérico

    dispose();
  });

  it('pasa systemPrompt al LLM en cada turno', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
      text: 'ok',
      emotion: 'neutral',
      tokensUsed: 1,
    });
    const llm: ILLMModule = { id: 'llm:spy', generate: generateSpy };
    const modules = makeModules({ llmLocal: llm });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro, una AI companion.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'u1' });

    expect(generateSpy).toHaveBeenCalledOnce();
    const args = generateSpy.mock.calls[0]?.[0];
    expect(args?.systemPrompt).toBe('Eres Shiro, una AI companion.');
    expect(args?.text).toBe('hola');
    expect(args?.userId).toBe('u1');

    dispose();
  });

  it('emite tts:audio-ended tras el delay simulado', async () => {
    vi.useFakeTimers();
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const modules = makeModules({
      llmLocal: makeLLM('llm:local-mock', {
        response: { text: 'corto', emotion: 'neutral', tokensUsed: 1 },
      }),
    });

    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      // speed = 1 normal, pero con fake timers controlamos el avance
    });

    await bus.emit('user:message', { text: 'hola', userId: 'u1' });
    expect(ended).toHaveLength(0);

    // El delay mínimo es 2200ms — avanzamos más.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.userId).toBe('u1');

    dispose();
    vi.useRealTimers();
  });

  it('si el router falla, emite fallback con emoción neutral', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const modules = makeModules({ router: makeRouter({ fail: true }) });

    const responded: EventMap['llm:responded'][] = [];
    bus.on('llm:responded', (p) => {
      responded.push(p);
    });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'u1' });
    await flushPromises();

    expect(responded).toHaveLength(1);
    expect(responded[0]?.emotion).toBe('neutral');
    expect(responded[0]?.text).toMatch(/algo sali/i);

    dispose();
  });

  it('si el LLM falla, emite fallback con emoción neutral', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const modules = makeModules({
      llmLocal: makeLLM('llm:local-mock', { fail: true }),
    });

    const responded: EventMap['llm:responded'][] = [];
    bus.on('llm:responded', (p) => {
      responded.push(p);
    });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'u1' });
    await flushPromises();

    expect(responded).toHaveLength(1);
    expect(responded[0]?.emotion).toBe('neutral');

    dispose();
  });

  it('dispose detiene el handler — emits posteriores no disparan el pipeline', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const router = makeRouter();
    const modules = makeModules({ router });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'uno', userId: 'u1' });
    expect(router.calls).toBe(1);

    dispose();

    await bus.emit('user:message', { text: 'dos', userId: 'u1' });
    expect(router.calls).toBe(1); // sin incrementar
  });

  it('LLM sin emotion en el response → fallback a neutral en el evento', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const modules = makeModules({
      llmLocal: makeLLM('llm:local-mock', {
        response: { text: 'sin emoción' },
      }),
    });

    const responded: EventMap['llm:responded'][] = [];
    bus.on('llm:responded', (p) => {
      responded.push(p);
    });

    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'u1' });
    expect(responded[0]?.emotion).toBe('neutral');

    dispose();
  });

  // ─── Tests de la integración con memoria ───────────────────────────

  describe('integración con memoria', () => {
    it('persiste el user msg al recibir user:message', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const memory = makeMemory();
      const modules = makeModules({ memory });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
      });

      await bus.emit('user:message', { text: 'hola Shiro', userId: 'me' });

      const userEntries = memory.saved.filter((e) => e.role === 'user');
      expect(userEntries).toHaveLength(1);
      expect(userEntries[0]?.text).toBe('hola Shiro');
      expect(userEntries[0]?.userId).toBe('me');
      expect(userEntries[0]?.id).toBeTruthy();
      expect(userEntries[0]?.timestamp).toMatch(/^2/);

      dispose();
    });

    it('persiste el assistant msg con metadata (emotion, tier, latencyMs)', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const memory = makeMemory();
      const modules = makeModules({
        memory,
        router: makeRouter({ tier: 'cloud' }),
        llmCloud: makeLLM('llm:cloud-mock', {
          response: { text: '¡hola!', emotion: 'divertida', tokensUsed: 8 },
        }),
      });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
      });

      await bus.emit('user:message', { text: 'hola', userId: 'me' });

      const assistantEntries = memory.saved.filter((e) => e.role === 'assistant');
      expect(assistantEntries).toHaveLength(1);
      const entry = assistantEntries[0];
      expect(entry?.text).toBe('¡hola!');
      expect(entry?.metadata).toMatchObject({
        emotion: 'divertida',
        tier: 'cloud',
      });
      expect(typeof entry?.metadata?.latencyMs).toBe('number');

      dispose();
    });

    it('pide getRecent + searchSemantic con los límites configurados', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const memory = makeMemory();
      const modules = makeModules({ memory });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
        memoryReads: { recentLimit: 7, semanticLimit: 2, timeoutMs: 1_000 },
      });

      await bus.emit('user:message', { text: 'algo', userId: 'me' });

      expect(memory.getRecentCalls).toEqual([{ userId: 'me', limit: 7 }]);
      expect(memory.searchCalls).toEqual([{ query: 'algo', userId: 'me', limit: 2 }]);

      dispose();
    });

    it('pasa el context formateado al LLM cuando hay entradas', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
        text: 'ok',
        emotion: 'neutral',
        tokensUsed: 1,
      });
      const memory = makeMemory({
        recent: [
          {
            id: 'r1',
            role: 'user',
            text: 'hola',
            timestamp: '2026-05-29T12:00:00.000Z',
            userId: 'me',
          },
          {
            id: 'r2',
            role: 'assistant',
            text: 'hola tú',
            timestamp: '2026-05-29T12:00:05.000Z',
            userId: 'me',
          },
        ],
        semantic: [
          {
            id: 's1',
            role: 'user',
            text: 'antes hablamos de X',
            timestamp: '2026-05-28T00:00:00.000Z',
            userId: 'me',
          },
        ],
      });
      const modules = makeModules({
        memory,
        llmLocal: { id: 'llm:spy', generate: generateSpy },
      });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
      });

      await bus.emit('user:message', { text: 'sigue', userId: 'me' });

      const req = generateSpy.mock.calls[0]?.[0];
      expect(req?.context).toBeDefined();
      expect(req?.context).toContain('Conversación reciente:');
      expect(req?.context).toContain('Usuario: hola');
      expect(req?.context).toContain('Shiro: hola tú');
      expect(req?.context).toContain('Otros momentos relevantes');
      expect(req?.context).toContain('antes hablamos de X');

      dispose();
    });

    it('no pasa context cuando memoria devuelve [] en ambas lecturas', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
        text: 'ok',
        emotion: 'neutral',
      });
      const modules = makeModules({
        memory: makeMemory(), // recent y semantic vacíos
        llmLocal: { id: 'llm:spy', generate: generateSpy },
      });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
      });

      await bus.emit('user:message', { text: 'hola', userId: 'me' });

      const req = generateSpy.mock.calls[0]?.[0];
      expect(req?.context).toBeUndefined();

      dispose();
    });

    it('si memory.getRecent supera el timeout, procede sin context', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
        text: 'ok',
        emotion: 'neutral',
      });
      const modules = makeModules({
        memory: makeMemory({ recentDelayMs: 200 }),
        llmLocal: { id: 'llm:spy', generate: generateSpy },
      });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
        memoryReads: { recentLimit: 5, semanticLimit: 3, timeoutMs: 20 },
      });

      await bus.emit('user:message', { text: 'hola', userId: 'me' });

      const req = generateSpy.mock.calls[0]?.[0];
      expect(req?.context).toBeUndefined();

      dispose();
    });

    it('un searchSemantic lento no impide usar el getRecent rápido', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
        text: 'ok',
        emotion: 'neutral',
      });
      const memory = makeMemory({
        recent: [
          {
            id: 'r1',
            role: 'user',
            text: 'soy pipe',
            timestamp: '2026-05-29T12:00:00.000Z',
            userId: 'me',
          },
        ],
        semantic: [
          {
            id: 's1',
            role: 'user',
            text: 'algo viejo',
            timestamp: '2026-05-01T00:00:00.000Z',
            userId: 'me',
          },
        ],
        semanticDelayMs: 200, // más lento que el timeout de lectura
      });
      const modules = makeModules({ memory, llmLocal: { id: 'llm:spy', generate: generateSpy } });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
        memoryReads: { recentLimit: 5, semanticLimit: 3, timeoutMs: 30 },
      });

      await bus.emit('user:message', { text: 'quien soy?', userId: 'me' });

      // El recent rápido entra en el context; el semantic lento se descarta por
      // timeout SIN tumbar el context entero. Ver ADR 0018.
      const req = generateSpy.mock.calls[0]?.[0];
      expect(req?.context).toContain('soy pipe');
      expect(req?.context).not.toContain('algo viejo');

      dispose();
    });

    it('si memory.save falla, el turno sigue (no rompe el flujo)', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const modules = makeModules({ memory: makeMemory({ saveFails: true }) });

      const responded: EventMap['llm:responded'][] = [];
      bus.on('llm:responded', (p) => {
        responded.push(p);
      });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
      });

      await bus.emit('user:message', { text: 'hola', userId: 'me' });
      await flushPromises();

      expect(responded).toHaveLength(1);
      expect(responded[0]?.emotion).toBe('neutral');

      dispose();
    });

    it('si searchSemantic no está implementado, usa solo getRecent', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const memory: IMemoryModule = {
        id: 'memory:no-semantic',
        save: () => Promise.resolve(),
        getRecent: () =>
          Promise.resolve([
            {
              id: 'r1',
              role: 'user',
              text: 'hola',
              timestamp: '2026-05-29T12:00:00.000Z',
              userId: 'me',
            },
          ]),
        // sin searchSemantic
        clear: () => Promise.resolve(),
      };
      const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
        text: 'ok',
        emotion: 'neutral',
      });
      const modules = makeModules({ memory, llmLocal: { id: 'llm:spy', generate: generateSpy } });

      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
      });

      await bus.emit('user:message', { text: 'hola', userId: 'me' });

      const req = generateSpy.mock.calls[0]?.[0];
      expect(req?.context).toContain('Usuario: hola');
      expect(req?.context).not.toContain('Otros momentos');

      dispose();
    });
  });
});
