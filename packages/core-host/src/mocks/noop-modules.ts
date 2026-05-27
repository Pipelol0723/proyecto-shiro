/**
 * Mocks no-op para los 7 slots del Orchestrator durante PR 3.
 *
 * El Orchestrator (`@proyecto-shiro/core`) carga los 7 módulos definidos
 * en `modules.config.yaml` al arranque. En esta fase del hito LLM todavía
 * no tenemos implementaciones reales (Ollama llega en PR 5, Anthropic en
 * PR 6, Router en PR 7, STT/TTS/Memory/Avatar son hitos posteriores).
 *
 * Para que el Orchestrator pueda inicializar sin error, registramos estos
 * stubs que satisfacen los contratos pero no hacen nada útil. La
 * "simulación visible" del flujo conversacional vive en
 * `mock-conversation-flow.ts` — independiente de los módulos, solo cablea
 * eventos sobre el bus.
 *
 * Estos mocks se irán reemplazando uno por uno en los PRs siguientes.
 */

import type {
  IAvatarModule,
  ILLMModule,
  IMemoryModule,
  IRouterModule,
  ISTTModule,
  ITTSModule,
  LLMRequest,
  LLMResponse,
  LLMTier,
  MemoryEntry,
  STTRequest,
  STTResult,
  TTSRequest,
  TTSResponse,
} from '@proyecto-shiro/core';

export class NoopLLM implements ILLMModule {
  readonly id: string;
  constructor(id = 'llm:noop') {
    this.id = id;
  }
  generate(_request: LLMRequest): Promise<LLMResponse> {
    return Promise.resolve({
      text: 'mock response (no LLM real cargado todavía)',
      emotion: 'neutral',
      tokensUsed: 0,
    });
  }
}

export class NoopRouter implements IRouterModule {
  readonly id = 'router:noop';
  route(_request: LLMRequest): Promise<LLMTier> {
    return Promise.resolve('local');
  }
}

export class NoopSTT implements ISTTModule {
  readonly id = 'stt:noop';
  transcribe(_request: STTRequest): Promise<STTResult> {
    return Promise.resolve({ text: '', isFinal: true });
  }
}

export class NoopTTS implements ITTSModule {
  readonly id = 'tts:noop';
  synthesize(_request: TTSRequest): Promise<TTSResponse> {
    return Promise.resolve({
      audio: Buffer.alloc(0),
      mimeType: 'audio/wav',
      duration: 0,
    });
  }
}

export class NoopMemory implements IMemoryModule {
  readonly id = 'memory:noop';
  private readonly store: MemoryEntry[] = [];

  save(entry: MemoryEntry): Promise<void> {
    this.store.push(entry);
    return Promise.resolve();
  }

  getRecent(userId: string, limit: number): Promise<MemoryEntry[]> {
    const filtered = this.store.filter((e) => e.userId === userId);
    return Promise.resolve(filtered.slice(-limit));
  }

  clear(userId: string): Promise<void> {
    for (let i = this.store.length - 1; i >= 0; i -= 1) {
      if (this.store[i]?.userId === userId) this.store.splice(i, 1);
    }
    return Promise.resolve();
  }
}

export class NoopAvatar implements IAvatarModule {
  readonly id = 'avatar:noop';
  setExpression(): Promise<void> {
    return Promise.resolve();
  }
  startLipSync(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
}
