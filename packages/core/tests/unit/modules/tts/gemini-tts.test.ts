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
    await expect(makeTts().synthesize({ text: SPOKEN })).rejects.toThrow(/audio/i);
  });

  it('lanza si el audio no es un WAV', async () => {
    const fake = Buffer.alloc(100, 7).toString('base64');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ steps: [{ content: [{ type: 'audio', data: fake }] }] }),
    );
    await expect(makeTts().synthesize({ text: SPOKEN })).rejects.toThrow(GeminiTTSError);
  });

  it('el error no contiene la clave ni el texto hablado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'boom' } }, 500));
    const err = (await makeTts()
      .synthesize({ text: SPOKEN })
      .catch((e: unknown) => e)) as GeminiTTSError;
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).not.toContain(SPOKEN);
  });
});
