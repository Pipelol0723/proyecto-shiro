import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@proyecto-shiro/core';
import type { ITTSModule, TTSRequest, TTSResponse } from '@proyecto-shiro/core';
import { TtsWithFallback } from '../../../src/tts/tts-with-fallback.js';

function makeTts(id: string, opts: { fail?: Error; response?: TTSResponse } = {}): ITTSModule {
  return {
    id,
    synthesize: vi.fn<(req: TTSRequest) => Promise<TTSResponse>>(() => {
      if (opts.fail !== undefined) return Promise.reject(opts.fail);
      return Promise.resolve(opts.response ?? { audio: Buffer.from(id), mimeType: 'audio/mpeg' });
    }),
  };
}

function makeLogger(): Logger {
  return new Logger('error', { module: 'test' });
}

describe('TtsWithFallback', () => {
  it('id concatena la cadena para diagnóstico', () => {
    const primary = makeTts('tts:elevenlabs:v1');
    const fallback = makeTts('tts:system');
    const tts = new TtsWithFallback({ primary, fallbacks: [fallback], logger: makeLogger() });
    expect(tts.id).toBe('tts:chain:tts:elevenlabs:v1→tts:system');
  });

  it('devuelve el resultado del primary cuando funciona', async () => {
    const primary = makeTts('p', { response: { audio: Buffer.from('P'), mimeType: 'audio/mpeg' } });
    const fallback = makeTts('f');
    const tts = new TtsWithFallback({ primary, fallbacks: [fallback], logger: makeLogger() });

    const res = await tts.synthesize({ text: 'hola' });
    expect(res.audio.toString()).toBe('P');
    expect(fallback.synthesize).not.toHaveBeenCalled();
  });

  it('cae al fallback cuando el primary lanza', async () => {
    const primary = makeTts('p', { fail: new Error('cuota') });
    const fallback = makeTts('f', {
      response: { audio: Buffer.from('F'), mimeType: 'audio/wav' },
    });
    const tts = new TtsWithFallback({ primary, fallbacks: [fallback], logger: makeLogger() });

    const res = await tts.synthesize({ text: 'hola' });
    expect(res.audio.toString()).toBe('F');
    expect(res.mimeType).toBe('audio/wav');
  });

  it('itera por todos los fallbacks hasta uno exitoso', async () => {
    const primary = makeTts('p', { fail: new Error('cuota') });
    const f1 = makeTts('f1', { fail: new Error('boom') });
    const f2 = makeTts('f2', {
      response: { audio: Buffer.from('F2'), mimeType: 'audio/wav' },
    });
    const tts = new TtsWithFallback({ primary, fallbacks: [f1, f2], logger: makeLogger() });

    const res = await tts.synthesize({ text: 'hola' });
    expect(res.audio.toString()).toBe('F2');
    expect(primary.synthesize).toHaveBeenCalledOnce();
    expect(f1.synthesize).toHaveBeenCalledOnce();
    expect(f2.synthesize).toHaveBeenCalledOnce();
  });

  it('lanza el último error si toda la cadena falla', async () => {
    const primary = makeTts('p', { fail: new Error('a') });
    const fallback = makeTts('f', { fail: new Error('b') });
    const tts = new TtsWithFallback({ primary, fallbacks: [fallback], logger: makeLogger() });

    await expect(tts.synthesize({ text: 'hola' })).rejects.toThrow('b');
  });

  it('sin fallbacks, propaga el error del primary tal cual', async () => {
    const primary = makeTts('p', { fail: new Error('solo yo') });
    const tts = new TtsWithFallback({ primary, fallbacks: [], logger: makeLogger() });
    await expect(tts.synthesize({ text: 'hola' })).rejects.toThrow('solo yo');
  });
});
