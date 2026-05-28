/**
 * Mocks no-op para los slots del Orchestrator que todavía no tienen
 * implementación real.
 *
 * El Orchestrator (`@proyecto-shiro/core`) carga los 7 módulos definidos
 * en `modules.config.yaml` al arranque. A partir de PR 7 los slots LLM
 * (local + cloud) y Router ya son implementaciones reales — quedan
 * solo STT/TTS/Memory/Avatar como noops hasta sus respectivos hitos.
 *
 * `NoopLLM` sigue exportado por si algún test quiere registrarlo en
 * lugar del OllamaLLM/AnthropicLLM real (e.g. tests que no quieren
 * tocar red).
 */

import type {
  IAvatarModule,
  ILLMModule,
  IMemoryModule,
  ISTTModule,
  ITTSModule,
  LLMRequest,
  LLMResponse,
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
