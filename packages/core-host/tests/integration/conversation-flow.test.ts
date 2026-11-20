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
  IToolsRegistry,
  ITTSModule,
  LLMRequest,
  LLMResponse,
  LLMTier,
  LoadedModules,
  MemoryEntry,
} from '@proyecto-shiro/core';
import { wireConversationFlow } from '../../src/pipeline/conversation-flow.js';
import { AudioCache } from '../../src/audio/audio-cache.js';

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
  /** Si se da, generate() rechaza con este error. */
  error?: Error;
}

function makeLLM(id: string, opts: LLMMockOptions = {}): ILLMModule & { calls: number } {
  let calls = 0;
  return {
    id,
    generate: async () => {
      calls += 1;
      if (opts.error !== undefined) throw opts.error;
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
    tools: { id: 'tools:noop' } as IToolsRegistry,
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

  describe('canal de error del turno (llm:failed)', () => {
    /** Como el SDK de Anthropic visto desde fuera: envuelto, con el status en la causa. */
    function cloudError(status: number): Error {
      return new Error('AnthropicLLM: fallo al llamar a la API', {
        cause: Object.assign(new Error(`respuesta ${String(status)}`), { status }),
      });
    }

    /** Ollama apagado: fetch falla y el motivo queda dos niveles más abajo. */
    function ollamaDown(): Error {
      const socketError = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      return new Error('OllamaLLM: fallo al llamar a http://localhost:11434/api/chat', {
        cause: new TypeError('fetch failed', { cause: socketError }),
      });
    }

    function run(modules: LoadedModules): {
      bus: EventBus<EventMap>;
      order: string[];
      failed: EventMap['llm:failed'][];
      responded: EventMap['llm:responded'][];
      dispose: () => void;
    } {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const order: string[] = [];
      const failed: EventMap['llm:failed'][] = [];
      const responded: EventMap['llm:responded'][] = [];
      bus.on('llm:failed', (p) => {
        order.push('llm:failed');
        failed.push(p);
      });
      bus.on('llm:responded', (p) => {
        order.push('llm:responded');
        responded.push(p);
      });
      const dispose = wireConversationFlow({
        bus,
        modules,
        systemPrompt: 'Eres Shiro.',
        logger: makeLogger(),
        simulationSpeed: 0,
      });
      return { bus, order, failed, responded, dispose };
    }

    it.each([
      [401, 'auth'],
      [429, 'quota'],
    ] as const)(
      'un %i de la nube emite llm:failed con el motivo y el turno sigue en local',
      async (status, reason) => {
        const { bus, order, failed, responded, dispose } = run(
          makeModules({
            router: makeRouter({ tier: 'cloud' }),
            llmCloud: makeLLM('llm:cloud-mock', { error: cloudError(status) }),
          }),
        );

        await bus.emit('user:message', { text: 'hola', userId: 'u1' });
        await flushPromises();

        expect(failed).toEqual([{ reason, tier: 'cloud', userId: 'u1' }]);
        expect(order).toEqual(['llm:failed', 'llm:responded']);
        expect(responded[0]?.tier).toBe('local');
        dispose();
      },
    );

    it('si también falla el local, avisa de cada modelo antes del fallback', async () => {
      const { bus, order, failed, responded, dispose } = run(
        makeModules({
          router: makeRouter({ tier: 'cloud' }),
          llmCloud: makeLLM('llm:cloud-mock', { error: cloudError(401) }),
          llmLocal: makeLLM('llm:local-mock', { error: ollamaDown() }),
        }),
      );

      await bus.emit('user:message', { text: 'hola', userId: 'u1' });
      await flushPromises();

      expect(failed).toEqual([
        { reason: 'auth', tier: 'cloud', userId: 'u1' },
        { reason: 'unavailable', tier: 'local', userId: 'u1' },
      ]);
      expect(order).toEqual(['llm:failed', 'llm:failed', 'llm:responded']);
      expect(responded[0]?.text).toMatch(/algo sali/i);
      dispose();
    });

    it('el evento no lleva el texto del error, solo la lista cerrada', async () => {
      const { bus, failed, dispose } = run(
        makeModules({ llmLocal: makeLLM('llm:local-mock', { error: ollamaDown() }) }),
      );

      await bus.emit('user:message', { text: 'hola', userId: 'u1' });
      await flushPromises();

      expect(Object.keys(failed[0] ?? {}).sort()).toEqual(['reason', 'tier', 'userId']);
      expect(JSON.stringify(failed)).not.toContain('localhost');
      dispose();
    });

    it('si falla el router, avisa con el nivel local y motivo desconocido', async () => {
      const { bus, failed, responded, dispose } = run(
        makeModules({ router: makeRouter({ fail: true }) }),
      );

      await bus.emit('user:message', { text: 'hola', userId: 'u1' });
      await flushPromises();

      expect(failed).toEqual([{ reason: 'unknown', tier: 'local', userId: 'u1' }]);
      expect(responded[0]?.text).toMatch(/algo sali/i);
      dispose();
    });

    it('un turno sin fallos no emite llm:failed', async () => {
      const { bus, failed, dispose } = run(makeModules());

      await bus.emit('user:message', { text: 'hola', userId: 'u1' });
      await flushPromises();

      expect(failed).toEqual([]);
      dispose();
    });
  });

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
      // Uno de más en la búsqueda: el propio mensaje puede salir y se descarta.
      expect(memory.searchCalls).toEqual([{ query: 'algo', userId: 'me', limit: 3 }]);

      dispose();
    });

    it('el mensaje actual no entra en su propio contexto, ni como reciente ni como parecido', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
        text: 'ok',
        emotion: 'neutral',
        tokensUsed: 1,
      });
      // Como la memoria de verdad: lo guardado ya se puede leer en el mismo
      // turno, y la búsqueda por parecido encuentra primero el propio mensaje.
      const stored: MemoryEntry[] = [
        {
          id: 'previo',
          role: 'assistant',
          text: 'lo de antes',
          timestamp: '2026-05-29T12:00:00.000Z',
          userId: 'me',
        },
      ];
      const memory: IMemoryModule = {
        id: 'memory:eco',
        save: (entry) => {
          stored.push(entry);
          return Promise.resolve();
        },
        getRecent: (_userId, limit, options) =>
          Promise.resolve(stored.filter((e) => e.id !== options?.excludeId).slice(-limit)),
        searchSemantic: () => Promise.resolve([...stored].reverse()),
        clear: () => Promise.resolve(),
      };
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

      await bus.emit('user:message', { text: 'mensaje de ahora', userId: 'me' });

      const req = generateSpy.mock.calls[0]?.[0];
      expect(req?.text).toBe('mensaje de ahora');
      expect(req?.context).toContain('lo de antes');
      expect(req?.context).not.toContain('mensaje de ahora');

      dispose();
    });

    it('un recuerdo parecido que ya está entre lo reciente no se repite, y el tope se respeta', async () => {
      const bus = new EventBus<EventMap>({ logger: makeLogger() });
      const generateSpy = vi.fn<(req: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
        text: 'ok',
        emotion: 'neutral',
        tokensUsed: 1,
      });
      const entry = (id: string): MemoryEntry => ({
        id,
        role: 'user',
        text: `texto de ${id}`,
        timestamp: '2026-05-29T12:00:00.000Z',
        userId: 'me',
      });
      const memory = makeMemory({
        recent: [entry('r1'), entry('r2')],
        // r2 ya está entre lo reciente; de los otros tres solo caben dos.
        semantic: [entry('r2'), entry('s1'), entry('s2'), entry('s3')],
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
        memoryReads: { recentLimit: 5, semanticLimit: 2, timeoutMs: 1_000 },
      });

      await bus.emit('user:message', { text: 'sigue', userId: 'me' });

      const context = generateSpy.mock.calls[0]?.[0]?.context ?? '';
      expect(context.split('texto de r2')).toHaveLength(2);
      expect(context).toContain('texto de s1');
      expect(context).toContain('texto de s2');
      expect(context).not.toContain('texto de s3');

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

// P-16 (R-134, R-135): antes solo había `latencyMs`, que se cortaba al tener
// el texto. Ahora cada turno dice cuánto tardó cada etapa, voz incluida.
describe('wireConversationFlow — tiempos del turno', () => {
  function run(modules: LoadedModules): {
    bus: EventBus<EventMap>;
    measured: EventMap['turn:measured'][];
    order: string[];
    dispose: () => void;
  } {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const measured: EventMap['turn:measured'][] = [];
    const order: string[] = [];
    bus.on('llm:responded', () => {
      order.push('llm:responded');
    });
    bus.on('turn:measured', (payload) => {
      measured.push(payload);
      order.push('turn:measured');
    });
    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });
    return { bus, measured, order, dispose };
  }

  it('al acabar emite cuánto tardó cada etapa, con el id del mensaje que abrió el turno', async () => {
    const memory = makeMemory();
    const { bus, measured, order, dispose } = run(makeModules({ memory }));

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    expect(measured).toHaveLength(1);
    const [timing] = measured;
    expect(timing?.userId).toBe('me');
    expect(timing?.tier).toBe('local');
    expect(timing?.turnId).toBe(memory.saved.find((entry) => entry.role === 'user')?.id);
    expect(Object.keys(timing?.stages ?? {})).toEqual([
      'route',
      'context',
      'llm',
      'persist',
      'tts',
    ]);
    for (const ms of Object.values(timing?.stages ?? {})) {
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
    expect(timing?.totalMs).toBeGreaterThanOrEqual(0);
    // Va al final: incluye lo que tarda la voz, que viene después del texto.
    expect(order).toEqual(['llm:responded', 'turn:measured']);

    dispose();
  });

  it('el tiempo de una etapa lenta sale en esa etapa', async () => {
    const memory = makeMemory({ recentDelayMs: 60 });
    const { bus, measured, dispose } = run(makeModules({ memory }));

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    const stages = measured[0]?.stages;
    expect(stages?.context).toBeGreaterThanOrEqual(50);
    expect(stages?.route).toBeLessThan(stages?.context ?? 0);
    expect(measured[0]?.totalMs).toBeGreaterThanOrEqual(stages?.context ?? 0);

    dispose();
  });

  it('si el turno falla, emite igualmente lo que llegó a medir', async () => {
    const { bus, measured, dispose } = run(
      makeModules({ llmLocal: makeLLM('llm:roto', { fail: true }) }),
    );

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    expect(measured).toHaveLength(1);
    expect(measured[0]?.tier).toBe('local');
    expect(measured[0]?.stages.llm).toBeDefined();
    expect(measured[0]?.stages.tts).toBeDefined();
    // No llegó a guardar ninguna respuesta.
    expect(measured[0]?.stages.persist).toBeUndefined();

    dispose();
  });
});

describe('wireConversationFlow — primer audio', () => {
  it('cuando el cliente dice que la voz empezó a sonar, deja en el log cuánto tardó', async () => {
    const info = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const cache = new AudioCache();
    const tts: ITTSModule = {
      id: 'tts:mock',
      synthesize: () => Promise.resolve({ audio: Buffer.from([1]), mimeType: 'audio/mpeg' }),
    };
    const audios: EventMap['tts:audio'][] = [];
    bus.on('tts:audio', (payload) => {
      audios.push(payload);
    });
    const dispose = wireConversationFlow({
      bus,
      modules: makeModules({ tts }),
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
      audioCache: cache,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'me' });
    const audioId = audios[0]?.audioId ?? '';
    const firstAudioLines = (): string[] =>
      info.mock.calls.map(([message]) => String(message)).filter((m) => m.includes('primer audio'));
    expect(firstAudioLines()).toEqual([]);

    await bus.emit('tts:audio-started', { audioId, userId: 'me' });
    // Repetido, o de un audio que no es de ningún turno: no cuenta.
    await bus.emit('tts:audio-started', { audioId, userId: 'me' });
    await bus.emit('tts:audio-started', { audioId: 'otro', userId: 'me' });

    expect(firstAudioLines()).toHaveLength(1);
    expect(firstAudioLines()[0]).toMatch(/primer audio a los \d+ ms/);

    cache.stop();
    dispose();
    info.mockRestore();
  });
});

describe('wireConversationFlow — tiempos del turno (revisión de P-16)', () => {
  it('llm:responded lleva el id del turno, el mismo que turn:measured', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const memory = makeMemory();
    const responded: EventMap['llm:responded'][] = [];
    const measured: EventMap['turn:measured'][] = [];
    bus.on('llm:responded', (payload) => {
      responded.push(payload);
    });
    bus.on('turn:measured', (payload) => {
      measured.push(payload);
    });
    const dispose = wireConversationFlow({
      bus,
      modules: makeModules({ memory }),
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    const turnId = memory.saved.find((entry) => entry.role === 'user')?.id;
    expect(turnId).toBeDefined();
    expect(responded[0]?.turnId).toBe(turnId);
    expect(measured[0]?.turnId).toBe(turnId);

    dispose();
  });

  it('si la nube falla y responde el local, «llm» suma los dos intentos y el orden no cambia', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const order: string[] = [];
    const measured: EventMap['turn:measured'][] = [];
    for (const name of ['llm:failed', 'llm:responded'] as const) {
      bus.on(name, () => {
        order.push(name);
      });
    }
    bus.on('turn:measured', (payload) => {
      measured.push(payload);
      order.push('turn:measured');
    });
    const slow = (ms: number, fail: boolean): ILLMModule => ({
      id: fail ? 'llm:nube' : 'llm:local',
      generate: async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        if (fail) throw new Error('sin clave');
        return { text: 'hola', emotion: 'neutral', tokensUsed: 1 };
      },
    });
    const dispose = wireConversationFlow({
      bus,
      modules: makeModules({
        router: makeRouter({ tier: 'cloud' }),
        llmCloud: slow(40, true),
        llmLocal: slow(40, false),
      }),
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    expect(order).toEqual(['llm:failed', 'llm:responded', 'turn:measured']);
    expect(measured[0]?.tier).toBe('local');
    expect(measured[0]?.stages.llm).toBeGreaterThanOrEqual(70);

    dispose();
  });

  it('un audio cancelado ya no cuenta como primer audio', async () => {
    const info = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const cache = new AudioCache();
    const tts: ITTSModule = {
      id: 'tts:mock',
      synthesize: () => Promise.resolve({ audio: Buffer.from([1]), mimeType: 'audio/mpeg' }),
    };
    const audios: EventMap['tts:audio'][] = [];
    bus.on('tts:audio', (payload) => {
      audios.push(payload);
    });
    const dispose = wireConversationFlow({
      bus,
      modules: makeModules({ tts }),
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
      audioCache: cache,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'me' });
    const audioId = audios[0]?.audioId ?? '';
    await bus.emit('tts:cancel', { audioId, userId: 'me' });
    await bus.emit('tts:audio-started', { audioId, userId: 'me' });

    const lines = info.mock.calls.map(([message]) => String(message));
    expect(lines.filter((line) => line.includes('primer audio'))).toEqual([]);

    cache.stop();
    dispose();
    info.mockRestore();
  });

  it('el audio queda apuntado antes de emitirse: un cliente inmediato también cuenta', async () => {
    const info = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const cache = new AudioCache();
    const tts: ITTSModule = {
      id: 'tts:mock',
      synthesize: () => Promise.resolve({ audio: Buffer.from([1]), mimeType: 'audio/mpeg' }),
    };
    // Un cliente en el mismo proceso que «suena» en cuanto recibe el audio.
    bus.on('tts:audio', (payload) => {
      void bus.emit('tts:audio-started', { audioId: payload.audioId, userId: payload.userId });
    });
    const dispose = wireConversationFlow({
      bus,
      modules: makeModules({ tts }),
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
      audioCache: cache,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    const lines = info.mock.calls.map(([message]) => String(message));
    expect(lines.filter((line) => line.includes('primer audio'))).toHaveLength(1);

    cache.stop();
    dispose();
    info.mockRestore();
  });
});

// IN-F: una respuesta sin texto (cortada por el tope de tokens, o vacía sin
// más) se entregaba tal cual: burbuja vacía, sin voz y sin aviso.
describe('wireConversationFlow — respuesta vacía', () => {
  function run(modules: LoadedModules): {
    bus: EventBus<EventMap>;
    failed: EventMap['llm:failed'][];
    responded: EventMap['llm:responded'][];
    dispose: () => void;
  } {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const failed: EventMap['llm:failed'][] = [];
    const responded: EventMap['llm:responded'][] = [];
    bus.on('llm:failed', (payload) => {
      failed.push(payload);
    });
    bus.on('llm:responded', (payload) => {
      responded.push(payload);
    });
    const dispose = wireConversationFlow({
      bus,
      modules,
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
    });
    return { bus, failed, responded, dispose };
  }

  const empty = (id: string, text: string): ILLMModule =>
    makeLLM(id, { response: { text, emotion: 'neutral', tokensUsed: 1 } });

  it('si el modelo local contesta sin texto, el turno falla con su motivo y no se guarda nada vacío', async () => {
    const memory = makeMemory();
    const { bus, failed, responded, dispose } = run(
      makeModules({ memory, llmLocal: empty('llm:local', '   ') }),
    );

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    expect(failed).toEqual([{ reason: 'empty', tier: 'local', userId: 'me' }]);
    expect(responded).toHaveLength(1);
    expect(responded[0]?.text.trim()).not.toBe('');
    expect(memory.saved.filter((entry) => entry.role === 'assistant')).toEqual([]);

    dispose();
  });

  it('si la nube contesta sin texto, se avisa y responde el modelo local', async () => {
    const { bus, failed, responded, dispose } = run(
      makeModules({
        router: makeRouter({ tier: 'cloud' }),
        llmCloud: empty('llm:nube', ''),
        llmLocal: empty('llm:local', 'aquí estoy'),
      }),
    );

    await bus.emit('user:message', { text: 'hola', userId: 'me' });

    expect(failed).toEqual([{ reason: 'empty', tier: 'cloud', userId: 'me' }]);
    expect(responded).toHaveLength(1);
    expect(responded[0]).toMatchObject({ text: 'aquí estoy', tier: 'local' });

    dispose();
  });
});

// Encontrado al medir la línea base con la app real: había varias copias del
// cliente conectadas y no salía ninguna línea de «primer audio».
describe('wireConversationFlow — primer audio con varios clientes', () => {
  it('un cliente que no reproduce y «termina» al instante no impide contar el de otro', async () => {
    const info = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => undefined);
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const cache = new AudioCache();
    const tts: ITTSModule = {
      id: 'tts:mock',
      synthesize: () => Promise.resolve({ audio: Buffer.from([1]), mimeType: 'audio/mpeg' }),
    };
    const audios: EventMap['tts:audio'][] = [];
    bus.on('tts:audio', (payload) => {
      audios.push(payload);
    });
    const dispose = wireConversationFlow({
      bus,
      modules: makeModules({ tts }),
      systemPrompt: 'Eres Shiro.',
      logger: makeLogger(),
      simulationSpeed: 0,
      audioCache: cache,
    });

    await bus.emit('user:message', { text: 'hola', userId: 'me' });
    const audioId = audios[0]?.audioId ?? '';
    // Una copia silenciada (o a la que el navegador no deja reproducir) da
    // el audio por terminado nada más recibirlo.
    await bus.emit('tts:audio-ended', { audioId, userId: 'me' });
    // Otra copia sí lo reproduce.
    await bus.emit('tts:audio-started', { audioId, userId: 'me' });

    const lines = info.mock.calls.map(([message]) => String(message));
    expect(lines.filter((line) => line.includes('primer audio'))).toHaveLength(1);

    cache.stop();
    dispose();
    info.mockRestore();
  });
});
