/**
 * Mocks de los módulos del core para tests de integración.
 *
 * Cada mock implementa la interfaz correspondiente con comportamiento
 * predecible y trazable (cada llamada se guarda en una lista pública
 * para que el test pueda assertarla). No usan los `deps` por defecto.
 *
 * Se registran en el `ModuleLoader` con los mismos nombres que se
 * usarían en producción (`MockLLM` en lugar de `OllamaLLM`, etc.).
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
} from '../../../src/index.js';
import type { Emotion } from '../../../src/types/emotions.js';

export class MockLLM implements ILLMModule {
  readonly id = 'mock-llm';
  readonly calls: LLMRequest[] = [];

  generate(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);
    return Promise.resolve({
      text: `echo: ${request.text}`,
      emotion: 'neutral',
    });
  }
}

export class MockRouter implements IRouterModule {
  readonly id = 'mock-router';
  readonly calls: LLMRequest[] = [];
  private nextDecision: LLMTier = 'local';

  /** Helper para tests: cambia la decisión que devolverá el siguiente route(). */
  setNextDecision(tier: LLMTier): void {
    this.nextDecision = tier;
  }

  route(request: LLMRequest): Promise<LLMTier> {
    this.calls.push(request);
    return Promise.resolve(this.nextDecision);
  }
}

export class MockSTT implements ISTTModule {
  readonly id = 'mock-stt';
  readonly transcribed: STTRequest[] = [];

  transcribe(request: STTRequest): Promise<STTResult> {
    this.transcribed.push(request);
    return Promise.resolve({
      text: 'transcripción mock',
      isFinal: true,
      confidence: 1.0,
    });
  }
}

export class MockTTS implements ITTSModule {
  readonly id = 'mock-tts';
  readonly synthesized: TTSRequest[] = [];

  synthesize(request: TTSRequest): Promise<TTSResponse> {
    this.synthesized.push(request);
    return Promise.resolve({
      audio: Buffer.from(`mock-audio:${request.text}`),
      mimeType: 'audio/wav',
      duration: 100,
    });
  }
}

export class MockMemory implements IMemoryModule {
  readonly id = 'mock-memory';
  readonly entries: MemoryEntry[] = [];

  save(entry: MemoryEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  getRecent(userId: string, limit: number): Promise<MemoryEntry[]> {
    const userEntries = this.entries.filter((e) => e.userId === userId);
    return Promise.resolve(userEntries.slice(-limit));
  }

  clear(userId: string): Promise<void> {
    const idx = this.entries.findIndex((e) => e.userId === userId);
    if (idx === -1) return Promise.resolve();
    this.entries.splice(0, this.entries.length, ...this.entries.filter((e) => e.userId !== userId));
    return Promise.resolve();
  }
}

export class MockAvatar implements IAvatarModule {
  readonly id = 'mock-avatar';
  readonly expressions: Emotion[] = [];
  readonly lipSyncCalls: number[] = [];
  private stopped = false;

  setExpression(emotion: Emotion): Promise<void> {
    this.expressions.push(emotion);
    return Promise.resolve();
  }

  startLipSync(audio: Buffer): Promise<void> {
    this.lipSyncCalls.push(audio.length);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  isStopped(): boolean {
    return this.stopped;
  }
}
