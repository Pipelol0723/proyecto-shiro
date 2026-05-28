/**
 * Tests del pipeline conversacional real con mocks de los módulos.
 *
 * Valida el flujo: user:message → router → LLM → llm:responded →
 * tts:audio-ended. No hace red — los mocks responden inmediatamente.
 *
 * Ver ADR 0016.
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

function makeModules(overrides: Partial<LoadedModules> = {}): LoadedModules {
  return {
    llmLocal: makeLLM('llm:local-mock'),
    llmCloud: makeLLM('llm:cloud-mock'),
    router: makeRouter(),
    stt: { id: 'stt:noop' } as ISTTModule,
    tts: { id: 'tts:noop' } as ITTSModule,
    memory: { id: 'memory:noop' } as unknown as IMemoryModule,
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
});
