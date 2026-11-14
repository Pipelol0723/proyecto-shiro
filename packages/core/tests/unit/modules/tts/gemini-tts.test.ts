/**
 * Tests de GeminiTTS (ADR 0034 §1, parte b-1). `fetch` simulado: ningún test
 * llama a Google. Los WAV son sintéticos y los identificadores, inventados.
 * El formato de la respuesta sigue la llamada real capturada el 2026-11-13.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import {
  GeminiTTS,
  GeminiTTSConfigSchema,
  GeminiTTSError,
} from '../../../../src/modules/tts/gemini-tts.js';

const API_KEY = 'test-key-no-real-0000';
const VOICE = 'voice_test000000';
const SPOKEN = 'frase secreta que se dice en voz alta';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

/** WAV PCM mono 24 kHz 16 bits; con `trailer` añade un bloque `C2PA` tras `data`. */
function makeWav(seconds: number, trailer = false): Buffer {
  const dataBytes = seconds * 24_000 * 2;
  const c2pa = trailer ? 7 : 0; // tamaño impar a propósito
  const buf = Buffer.alloc(44 + dataBytes + (trailer ? 8 + c2pa + 1 : 0));
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(24_000, 24);
  buf.writeUInt32LE(48_000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  if (trailer) {
    const at = 44 + dataBytes;
    buf.write('C2PA', at, 'ascii');
    buf.writeUInt32LE(c2pa, at + 4);
  }
  return buf;
}

function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => 'application/json' } as unknown as Headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text),
  } as Response;
}

function audioBody(wav: Buffer): unknown {
  return {
    id: 'v1_test',
    status: 'completed',
    steps: [
      {
        type: 'model_output',
        content: [{ type: 'audio', mime_type: 'audio/wav', data: wav.toString('base64') }],
      },
    ],
  };
}

function makeTts(): GeminiTTS {
  return new GeminiTTS({ voice_id: VOICE }, makeDeps(), { apiKey: API_KEY });
}

describe('GeminiTTS', () => {
  const fetchMock = vi.fn();
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  it('aplica los defaults de la config', () => {
    const cfg = GeminiTTSConfigSchema.parse({ voice_id: VOICE });
    expect(cfg.model_id).toBe('gemini-3.8-flash-tts');
    expect(cfg.base_url).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(cfg.timeout_ms).toBe(30_000);
    expect(makeTts().id).toBe(`tts:gemini:${VOICE}`);
  });

  it('sintetiza con un WAV válido y devuelve audio/wav con su duración', async () => {
    const wav = makeWav(2);
    fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(wav)));
    const res = await makeTts().synthesize({ text: SPOKEN });
    expect(res.mimeType).toBe('audio/wav');
    expect(res.audio.equals(wav)).toBe(true);
    expect(res.duration).toBeCloseTo(2000, 3);
  });

  it('la duración sale del bloque data aunque haya un bloque C2PA tras él', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(1, true))));
    const res = await makeTts().synthesize({ text: SPOKEN });
    expect(res.duration).toBeCloseTo(1000, 3);
  });

  it('envía x-goog-api-key, modelo, voz y response_format audio', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(1))));
    await makeTts().synthesize({ text: SPOKEN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(API_KEY);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gemini-3.8-flash-tts',
      input: [{ type: 'user_input', content: [{ type: 'text', text: SPOKEN }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: VOICE }] },
    });
  });

  it('no envía annotations', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(1))));
    await makeTts().synthesize({ text: SPOKEN });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).not.toContain('annotations');
  });

  it('toma el primer contenido de audio aunque haya pasos o contenidos sin audio antes', async () => {
    const wav = makeWav(1);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        steps: [
          { type: 'thought', content: [{ type: 'text', text: 'hmm' }] },
          {
            type: 'model_output',
            content: [
              { type: 'text', text: 'nota' },
              { type: 'audio', mime_type: 'audio/wav', data: wav.toString('base64') },
            ],
          },
        ],
      }),
    );
    const res = await makeTts().synthesize({ text: SPOKEN });
    expect(res.audio.equals(wav)).toBe(true);
  });

  it('lanza con 401 y conserva el status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 401 } }, 401));
    const err = await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GeminiTTSError);
    expect((err as GeminiTTSError).status).toBe(401);
  });

  it('lanza con 429 sin reintentar (fetch llamado una vez)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 429 } }, 429));
    const err = await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e);
    expect((err as GeminiTTSError).status).toBe(429);
    expect((err as GeminiTTSError).message).toMatch(/cuota/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lanza con otro HTTP y recorta el cuerpo a 200 caracteres', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'x'.repeat(1000) } }, 500));
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.status).toBe(500);
    expect(err.message).toContain('xxxx');
    expect(err.message.length).toBeLessThan(400);
    expect(err.message).not.toContain('x'.repeat(201));
  });

  it('lanza si la respuesta no trae audio', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'hola' }] }],
      }),
    );
    await expect(makeTts().synthesize({ text: SPOKEN })).rejects.toThrow(/no trae audio/);
  });

  it('lanza si el audio no es un WAV', async () => {
    const fake = Buffer.alloc(100, 7).toString('base64');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ steps: [{ content: [{ type: 'audio', data: fake }] }] }),
    );
    await expect(makeTts().synthesize({ text: SPOKEN })).rejects.toThrow(/WAV válido/);
  });

  it('rechaza una config inválida con el campo en el mensaje', () => {
    expect(() => new GeminiTTS({ voice_id: 7 }, makeDeps(), { apiKey: API_KEY })).toThrow(
      /voice_id/,
    );
    expect(
      () => new GeminiTTS({ voice_id: VOICE, timeout_ms: -1 }, makeDeps(), { apiKey: API_KEY }),
    ).toThrow(/timeout_ms/);
    for (const base_url of ['ftp://x.test', 'https://u:p@x.test', 'https://x.test/v1?key=abc']) {
      expect(() => new GeminiTTS({ voice_id: VOICE, base_url }, makeDeps())).toThrow(/base_url/);
    }
  });

  it('el 401 no incluye la clave ni el texto', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: API_KEY + SPOKEN } }, 401));
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).not.toContain(SPOKEN);
  });

  it.each([400, 429, 500])('un %i con clave y texto en el cuerpo sale redactado', async (code) => {
    const text = 'dime "algo"\ncon salto';
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: `campo ${text} clave ${API_KEY}` } }, code),
    );
    const err = (await makeTts()
      .synthesize({ text })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.status).toBe(code);
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).not.toContain('algo');
    expect(err.message).toContain('[redactado]');
  });

  it('no deja un trozo de la clave en el borde del recorte', async () => {
    const body = 'a'.repeat(190) + API_KEY;
    fetchMock.mockResolvedValueOnce({
      ...jsonResponse({}, 500),
      text: () => Promise.resolve(body),
    });
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.message).not.toContain(API_KEY.slice(0, 5));
  });

  it('fetch rechazado: sin status, causa conservada y solo el origen en el mensaje', async () => {
    const cause = new Error('socket roto');
    fetchMock.mockRejectedValueOnce(cause);
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err).toBeInstanceOf(GeminiTTSError);
    expect(err.status).toBeUndefined();
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('https://generativelanguage.googleapis.com');
    expect(err.message).not.toContain('/v1beta');
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).not.toContain(SPOKEN);
  });

  it('JSON ilegible: "no es JSON" con status 200', async () => {
    fetchMock.mockResolvedValueOnce({
      ...jsonResponse({}),
      text: () => Promise.resolve('no es json {'),
    });
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.message).toMatch(/no es JSON/);
    expect(err.status).toBe(200);
  });

  it('data que no es base64 da un GeminiTTSError propio', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ steps: [{ content: [{ type: 'audio', data: '!!!no-base64!!!' }] }] }),
    );
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err).toBeInstanceOf(GeminiTTSError);
    expect(err.message).toMatch(/base64/);
  });

  it('rechaza base64 con caracteres sobrantes tras el relleno', async () => {
    // Un WAV válido en base64 seguido de una letra suelta no es base64 válido.
    const wav = makeWav(1).toString('base64');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        steps: [{ content: [{ type: 'audio', data: `${wav.replace(/=+$/, '')}==s` }] }],
      }),
    );
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err).toBeInstanceOf(GeminiTTSError);
    expect(err.message).toMatch(/base64/);
  });

  it('respuesta sin audio: mensaje y status 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ steps: [] }));
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.message).toMatch(/no trae audio/);
    expect(err.status).toBe(200);
  });

  it('el error de 500 no contiene la clave ni el texto hablado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'boom' } }, 500));
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).not.toContain(SPOKEN);
  });

  describe('tiempo máximo, guardas y avisos (b-2)', () => {
    /** Registra todo lo que el módulo escriba en el logger. */
    function spyLogs(): string[] {
      const lines: string[] = [];
      for (const level of ['info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation((msg: string, payload?: object) => {
          lines.push(msg + (payload === undefined ? '' : JSON.stringify(payload)));
        });
      }
      return lines;
    }

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('lanza por tiempo agotado cuando el fetch no responde', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      );
      const tts = new GeminiTTS({ voice_id: VOICE, timeout_ms: 1000 }, makeDeps(), {
        apiKey: API_KEY,
      });
      const pending = tts.synthesize({ text: SPOKEN }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1001);
      const err = (await pending) as GeminiTTSError;
      expect(err).toBeInstanceOf(GeminiTTSError);
      expect(err.message).toMatch(/tiempo|agotó/i);
      expect(err.message).toContain('1000');
      expect(err.message).not.toContain(API_KEY);
      expect(err.message).not.toContain(SPOKEN);
    });

    /** Respuesta con cabeceras ya recibidas y un cuerpo que no llega hasta que se aborta. */
    function hungBodyResponse(status: number, signal: AbortSignal | null | undefined): Response {
      const hang = (): Promise<never> =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'application/json' } as unknown as Headers,
        json: hang,
        text: hang,
      } as unknown as Response;
    }

    it.each([200, 500])(
      'el tiempo máximo también cubre el cuerpo colgado (status %i)',
      async (status) => {
        vi.useFakeTimers();
        fetchMock.mockImplementation((_url: string, init: RequestInit) =>
          Promise.resolve(hungBodyResponse(status, init.signal)),
        );
        const tts = new GeminiTTS({ voice_id: VOICE, timeout_ms: 1000 }, makeDeps(), {
          apiKey: API_KEY,
        });
        const pending = tts.synthesize({ text: SPOKEN }).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(1001);
        const err = (await pending) as GeminiTTSError;
        expect(err).toBeInstanceOf(GeminiTTSError);
        expect(err.message).toMatch(/tiempo agotado/i);
      },
    );

    it('un AbortError que no es DOMException también se informa como tiempo agotado', async () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetchMock.mockRejectedValueOnce(abort);
      const err = (await makeTts()
        .synthesize({ text: SPOKEN })
        .catch((e: unknown) => e)) as GeminiTTSError;
      expect(err.message).toMatch(/tiempo agotado/i);
    });

    it('no deja temporizadores vivos tras un éxito ni tras un fallo', async () => {
      vi.useFakeTimers();
      const tts = makeTts();
      fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(1))));
      await tts.synthesize({ text: SPOKEN });
      expect(vi.getTimerCount()).toBe(0);
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await tts.synthesize({ text: SPOKEN }).catch(() => undefined);
      expect(vi.getTimerCount()).toBe(0);
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
      await tts.synthesize({ text: SPOKEN }).catch(() => undefined);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('un voice_id solo de espacios cuenta como vacío', async () => {
      const logs = spyLogs();
      const tts = new GeminiTTS({ voice_id: '   ' }, makeDeps(), { apiKey: API_KEY });
      expect(logs.some((l) => l.includes('voice_id'))).toBe(true);
      await expect(tts.synthesize({ text: SPOKEN })).rejects.toThrow(/voice_id/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lanza por fallo de red con mensaje legible', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      const err = (await makeTts()
        .synthesize({ text: SPOKEN })
        .catch((e: unknown) => e)) as GeminiTTSError;
      expect(err).toBeInstanceOf(GeminiTTSError);
      expect(err.message).toMatch(/red|conexi/i);
      expect(err.message).toContain('https://generativelanguage.googleapis.com');
    });

    it('el constructor no lanza sin clave y avisa; synthesize lanza', async () => {
      const logs = spyLogs();
      const tts = new GeminiTTS({ voice_id: VOICE }, makeDeps());
      expect(logs.some((l) => l.includes('GEMINI_API_KEY'))).toBe(true);
      await expect(tts.synthesize({ text: SPOKEN })).rejects.toThrow(/GEMINI_API_KEY/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('el constructor no lanza sin voice_id y avisa; synthesize lanza', async () => {
      const logs = spyLogs();
      const tts = new GeminiTTS({}, makeDeps(), { apiKey: API_KEY });
      expect(logs.some((l) => l.includes('voice_id'))).toBe(true);
      await expect(tts.synthesize({ text: SPOKEN })).rejects.toThrow(/voice_id/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['', '   \n\t'])('lanza con texto vacío (%j) sin llamar a la API', async (text) => {
      await expect(makeTts().synthesize({ text })).rejects.toThrow(/vacío/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('registra el aviso de privacidad una sola vez al construirse con clave', async () => {
      const logs = spyLogs();
      const tts = makeTts();
      fetchMock.mockResolvedValue(jsonResponse(audioBody(makeWav(1))));
      await tts.synthesize({ text: SPOKEN });
      await tts.synthesize({ text: SPOKEN });
      const privacy = logs.filter((l) => l.includes('se envía a Google'));
      expect(privacy).toHaveLength(1);
      expect(privacy[0]).toContain('nivel gratuito');
    });

    it('no registra el aviso de privacidad sin clave', () => {
      const logs = spyLogs();
      new GeminiTTS({ voice_id: VOICE }, makeDeps());
      expect(logs.some((l) => l.includes('se envía a Google'))).toBe(false);
    });

    it('la clave no aparece en ningún mensaje de log ni de error', async () => {
      const logs = spyLogs();
      const errors: string[] = [];
      const tts = makeTts();
      fetchMock.mockRejectedValueOnce(new Error(`red caída ${API_KEY}`));
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: API_KEY } }, 500));
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: API_KEY } }, 401));
      for (let i = 0; i < 3; i++) {
        const err = (await tts.synthesize({ text: SPOKEN }).catch((e: unknown) => e)) as Error;
        errors.push(err.message);
      }
      await tts.synthesize({ text: '' }).catch((e: unknown) => errors.push((e as Error).message));
      expect(logs.length).toBeGreaterThan(0);
      for (const line of [...logs, ...errors]) expect(line).not.toContain(API_KEY);
    });
  });

  describe('contador de segundos (ADR 0034 §4)', () => {
    /** Sink falso en memoria: ningún test de core toca el disco. */
    function makeSink(): { record: ReturnType<typeof vi.fn>; total: () => number } {
      let total = 0;
      const record = vi.fn((seconds: number) => {
        total += seconds;
        return total;
      });
      return { record, total: () => total };
    }

    function spyWarns(): string[] {
      const lines: string[] = [];
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((msg: string, payload?: object) => {
        lines.push(msg + (payload === undefined ? '' : JSON.stringify(payload)));
      });
      return lines;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('suma la duración de cada síntesis correcta al sink', async () => {
      const sink = makeSink();
      const tts = new GeminiTTS({ voice_id: VOICE }, makeDeps(), { apiKey: API_KEY, usage: sink });
      fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(2))));
      fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(3))));
      await tts.synthesize({ text: SPOKEN });
      await tts.synthesize({ text: SPOKEN });
      expect(sink.record).toHaveBeenCalledTimes(2);
      expect(sink.total()).toBeCloseTo(5, 3);
    });

    it('no suma si la síntesis falla', async () => {
      const sink = makeSink();
      const tts = new GeminiTTS({ voice_id: VOICE }, makeDeps(), { apiKey: API_KEY, usage: sink });
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
      fetchMock.mockResolvedValueOnce(jsonResponse({ steps: [] }));
      await tts.synthesize({ text: SPOKEN }).catch(() => undefined);
      await tts.synthesize({ text: SPOKEN }).catch(() => undefined);
      expect(sink.record).not.toHaveBeenCalled();
    });

    it('avisa una sola vez al cruzar monthly_warn_seconds', async () => {
      const warns = spyWarns();
      const sink = makeSink();
      const tts = new GeminiTTS({ voice_id: VOICE, monthly_warn_seconds: 5 }, makeDeps(), {
        apiKey: API_KEY,
        usage: sink,
      });
      for (const secs of [2, 2, 2, 2]) {
        fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(secs))));
        await tts.synthesize({ text: SPOKEN });
      }
      const umbral = warns.filter((l) => l.includes('umbral'));
      expect(umbral).toHaveLength(1);
      expect(umbral[0]).toContain('6');
      expect(umbral[0]).toContain('5');
    });

    it('un sink que lanza no rompe la síntesis y avisa una sola vez', async () => {
      const warns = spyWarns();
      const usage = {
        record: vi.fn(() => {
          throw new Error('disco lleno');
        }),
      };
      const tts = new GeminiTTS({ voice_id: VOICE }, makeDeps(), { apiKey: API_KEY, usage });
      fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(1))));
      fetchMock.mockResolvedValueOnce(jsonResponse(audioBody(makeWav(1))));
      const first = await tts.synthesize({ text: SPOKEN });
      const second = await tts.synthesize({ text: SPOKEN });
      expect(first.duration).toBeCloseTo(1000, 3);
      expect(second.duration).toBeCloseTo(1000, 3);
      expect(usage.record).toHaveBeenCalledTimes(2);
      expect(warns.filter((l) => l.includes('contador'))).toHaveLength(1);
    });

    it('monthly_warn_seconds vale 6000 por defecto y exige un entero positivo', () => {
      expect(GeminiTTSConfigSchema.parse({ voice_id: VOICE }).monthly_warn_seconds).toBe(6000);
      expect(GeminiTTSConfigSchema.safeParse({ monthly_warn_seconds: 0 }).success).toBe(false);
      expect(GeminiTTSConfigSchema.safeParse({ monthly_warn_seconds: 1.5 }).success).toBe(false);
    });
  });
});
