/**
 * Tests del SystemTTS — fallback usando la voz nativa del OS via `say.js`.
 *
 * Inyectamos un fake `SayLike` y stubs de FS para no tocar el binario
 * real del sistema operativo. Verifica el contrato: que `say.export`
 * se llame con los parámetros correctos, que el WAV resultante se lea
 * y devuelva, y que los caminos de error den mensajes legibles.
 */

import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import {
  SystemTTS,
  SystemTTSConfigSchema,
  SystemTTSError,
} from '../../../../src/modules/tts/system-tts.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

interface SayCall {
  text: string;
  voice: string | null;
  speed: number | null;
  filename: string;
}

/** Fake de `SayLike` que captura las llamadas y resuelve con éxito. */
function makeFakeSay(opts: { fail?: Error; neverCalls?: boolean } = {}): {
  say: {
    export: (
      text: string,
      voice: string | null,
      speed: number | null,
      filename: string,
      cb: (err: Error | null) => void,
    ) => void;
    getInstalledVoices: (cb: (err: Error | null, voices: string[]) => void) => void;
  };
  calls: SayCall[];
} {
  const calls: SayCall[] = [];
  return {
    say: {
      export: (text, voice, speed, filename, cb) => {
        calls.push({ text, voice, speed, filename });
        if (opts.neverCalls === true) return;
        // Defer al microtask para emular comportamiento async real.
        queueMicrotask(() => {
          cb(opts.fail ?? null);
        });
      },
      getInstalledVoices: (cb) => {
        cb(null, []);
      },
    },
    calls,
  };
}

describe('SystemTTSConfigSchema', () => {
  it('aplica defaults cuando el input está vacío', () => {
    const cfg = SystemTTSConfigSchema.parse({});
    expect(cfg.voice).toBe('');
    expect(cfg.speed).toBe(1.0);
    expect(cfg.timeout_ms).toBe(15_000);
  });

  it('rechaza speed no positivo', () => {
    expect(() => SystemTTSConfigSchema.parse({ speed: 0 })).toThrow();
    expect(() => SystemTTSConfigSchema.parse({ speed: -0.5 })).toThrow();
  });

  it('rechaza timeout_ms no positivo', () => {
    expect(() => SystemTTSConfigSchema.parse({ timeout_ms: 0 })).toThrow();
  });
});

describe('SystemTTS', () => {
  it('id es estable "tts:system"', () => {
    const { say } = makeFakeSay();
    const tts = new SystemTTS({}, makeDeps(), { say });
    expect(tts.id).toBe('tts:system');
  });

  it('constructor lanza SystemTTSError con config inválida', () => {
    expect(() => new SystemTTS({ speed: -1 }, makeDeps())).toThrow(SystemTTSError);
  });

  describe('synthesize()', () => {
    it('lanza si el texto está vacío', async () => {
      const { say } = makeFakeSay();
      const tts = new SystemTTS({}, makeDeps(), { say });
      await expect(tts.synthesize({ text: '   ' })).rejects.toThrow(/texto.*vacío/);
    });

    it('llama say.export con el texto, voz null por defecto y speed 1.0', async () => {
      const { say, calls } = makeFakeSay();
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.from('WAV-DATA')),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      await tts.synthesize({ text: 'hola Shiro' });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        text: 'hola Shiro',
        voice: null,
        speed: 1.0,
        filename: '/tmp/test.wav',
      });
    });

    it('usa la voz del config cuando viene poblada', async () => {
      const { say, calls } = makeFakeSay();
      const tts = new SystemTTS({ voice: 'Microsoft Aria', speed: 1.2 }, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.from('x')),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      await tts.synthesize({ text: 'hola' });

      expect(calls[0]?.voice).toBe('Microsoft Aria');
      expect(calls[0]?.speed).toBe(1.2);
    });

    it('devuelve el buffer leído del archivo y mimeType audio/wav', async () => {
      const { say } = makeFakeSay();
      const audio = Buffer.from('RIFF....WAVEfmt ');
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.resolve(audio),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      const res = await tts.synthesize({ text: 'hola' });

      expect(res.audio).toBe(audio);
      expect(res.mimeType).toBe('audio/wav');
    });

    it('borra el archivo temporal tras leerlo (cleanup)', async () => {
      const { say } = makeFakeSay();
      const unlinkSpy = vi.fn(() => Promise.resolve());
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.from('x')),
        unlink: unlinkSpy,
        makeTempPath: () => '/tmp/test.wav',
      });

      await tts.synthesize({ text: 'hola' });

      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/test.wav');
    });

    it('un unlink que falla no rompe el turno (best-effort)', async () => {
      const { say } = makeFakeSay();
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.from('x')),
        unlink: () => Promise.reject(new Error('EBUSY')),
        makeTempPath: () => '/tmp/test.wav',
      });

      const res = await tts.synthesize({ text: 'hola' });
      expect(res.audio.byteLength).toBe(1);
    });

    it('emoción del request se ignora silenciosamente (debug log)', async () => {
      const { say, calls } = makeFakeSay();
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.from('x')),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      await tts.synthesize({ text: 'hola', emotion: 'molesta' });

      // El call a `say.export` no incluye la emoción de ningún modo.
      expect(calls[0]?.text).toBe('hola');
    });

    it('propaga el error de say.export como SystemTTSError', async () => {
      const { say } = makeFakeSay({ fail: new Error('SAPI not installed') });
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.from('x')),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      const err = await tts.synthesize({ text: 'hola' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SystemTTSError);
      expect((err as Error).message).toContain('SAPI not installed');
    });

    it('lanza si el archivo exportado está vacío', async () => {
      const { say } = makeFakeSay();
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.alloc(0)),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      await expect(tts.synthesize({ text: 'hola' })).rejects.toThrow(/vacío/);
    });

    it('lanza si readFile rechaza', async () => {
      const { say } = makeFakeSay();
      const tts = new SystemTTS({}, makeDeps(), {
        say,
        readFile: () => Promise.reject(new Error('ENOENT')),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      await expect(tts.synthesize({ text: 'hola' })).rejects.toThrow(/no se pudo leer/);
    });

    it('respeta el timeout cuando say.export nunca llama al callback', async () => {
      const { say } = makeFakeSay({ neverCalls: true });
      const tts = new SystemTTS({ timeout_ms: 30 }, makeDeps(), {
        say,
        readFile: () => Promise.resolve(Buffer.from('x')),
        unlink: () => Promise.resolve(),
        makeTempPath: () => '/tmp/test.wav',
      });

      const err = await tts.synthesize({ text: 'hola' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SystemTTSError);
      expect((err as Error).message).toContain('timeout');
    });
  });
});
