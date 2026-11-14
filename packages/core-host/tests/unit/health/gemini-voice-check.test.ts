/**
 * Tests de gemini-voice-check — caducidad de la voz diseñada de Gemini
 * (ADR 0034 §5). `fetch` y el reloj se inyectan: no hay red real.
 *
 * Las formas de respuesta (200 con `expire_time` RFC 3339 de nueve decimales y
 * 404 con `error.status = NOT_FOUND`) son las observadas en llamadas reales;
 * los identificadores y el audio de aquí son sintéticos.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  checkGeminiVoice,
  resolveGeminiVoiceTarget,
} from '../../../src/health/gemini-voice-check.js';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = 'http://gemini.test/v1beta';
const API_KEY = 'AIza-clave-de-prueba-123';
const VOICE_ID = 'voice_test000000';

/** `expire_time` con nueve decimales, a `days` días (con fracción) de NOW. */
function expireIn(days: number): string {
  const iso = new Date(NOW.getTime() + days * DAY_MS).toISOString(); // …mmmZ
  return iso.replace('Z', '123456Z'); // nueve decimales, como la API real
}

function voiceResponse(expireTime: unknown): Response {
  return new Response(
    JSON.stringify({
      id: VOICE_ID,
      type: 'prompted',
      expire_time: expireTime,
      sample_audio: { mime_type: 'audio/wav', data: 'AAAA' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function notFoundResponse(): Response {
  return new Response(
    JSON.stringify({ error: { code: 404, message: 'no existe', status: 'NOT_FOUND' } }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );
}

function run(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof checkGeminiVoice>[0]> = {},
): ReturnType<typeof checkGeminiVoice> {
  return checkGeminiVoice({
    apiKey: API_KEY,
    voiceId: VOICE_ID,
    baseUrl: BASE,
    fetchImpl,
    now: NOW,
    ...overrides,
  });
}

function fetchReturning(res: Response): typeof fetch {
  return vi.fn(() => Promise.resolve(res));
}

describe('checkGeminiVoice', () => {
  it.each([
    { days: 31, status: 'ok', daysLeft: 31 },
    { days: 30, status: 'ok', daysLeft: 30 },
    { days: 29, status: 'expiring', daysLeft: 29 },
    { days: 0.5, status: 'expiring', daysLeft: 0 },
  ])('con $days días: $status', async ({ days, status, daysLeft }) => {
    const result = await run(fetchReturning(voiceResponse(expireIn(days))));
    expect(result.status).toBe(status);
    expect(result.daysLeft).toBe(daysLeft);
    expect(result.expiresAt).toBe(new Date(NOW.getTime() + days * DAY_MS).toISOString());
  });

  it('expired si ya caducó', async () => {
    const result = await run(fetchReturning(voiceResponse(expireIn(-2))));
    expect(result.status).toBe('expired');
    expect(result.expiresAt).toBeDefined();
  });

  it('expired justo en el instante de caducar', async () => {
    const result = await run(fetchReturning(voiceResponse(NOW.toISOString())));
    expect(result.status).toBe('expired');
  });

  it.each([401, 429, 500])('unknown ante HTTP %i', async (code) => {
    const res = new Response('{}', { status: code });
    expect(await run(fetchReturning(res))).toEqual({ status: 'unknown' });
  });

  it('missing ante 404', async () => {
    const result = await run(fetchReturning(notFoundResponse()));
    expect(result).toEqual({ status: 'missing' });
  });

  it('unknown sin clave (no llama a fetch)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await run(fetchImpl, { apiKey: undefined })).toEqual({ status: 'unknown' });
    expect(await run(fetchImpl, { apiKey: '   ' })).toEqual({ status: 'unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('unknown sin voice_id (no llama a fetch)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await run(fetchImpl, { voiceId: '' })).toEqual({ status: 'unknown' });
    expect(await run(fetchImpl, { voiceId: undefined })).toEqual({ status: 'unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('unknown ante error de red', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error('network down')),
    ) as unknown as typeof fetch;
    expect(await run(fetchImpl)).toEqual({ status: 'unknown' });
  });

  it('unknown ante un error HTTP distinto de 404', async () => {
    const res = new Response('{}', { status: 500 });
    expect(await run(fetchReturning(res))).toEqual({ status: 'unknown' });
  });

  it.each([['no-es-una-fecha'], [undefined], [12345], [null]])(
    'unknown ante expire_time ilegible (%s)',
    async (bad) => {
      expect(await run(fetchReturning(voiceResponse(bad)))).toEqual({ status: 'unknown' });
    },
  );

  it('unknown ante un cuerpo que no es JSON', async () => {
    const res = new Response('<html>', { status: 200 });
    expect(await run(fetchReturning(res))).toEqual({ status: 'unknown' });
  });

  it('unknown si la petición excede el tiempo máximo', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('abortado'));
          });
        }),
    ) as unknown as typeof fetch;
    expect(await run(fetchImpl, { timeoutMs: 20 })).toEqual({ status: 'unknown' });
  });

  it('envía x-goog-api-key y consulta GET {base}/voices/{id}', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(voiceResponse(expireIn(100))));
    await run(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/voices/${VOICE_ID}`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(API_KEY);
  });

  it('la clave no aparece en el resultado', async () => {
    const results = [
      await run(fetchReturning(voiceResponse(expireIn(100)))),
      await run(fetchReturning(notFoundResponse())),
      await run(vi.fn(() => Promise.reject(new Error(API_KEY)))),
    ];
    for (const r of results) expect(JSON.stringify(r)).not.toContain(API_KEY);
  });

  it('no incluye sample_audio en el resultado', async () => {
    const result = await run(fetchReturning(voiceResponse(expireIn(100))));
    expect(Object.keys(result).sort()).toEqual(['daysLeft', 'expiresAt', 'status']);
  });
});

describe('resolveGeminiVoiceTarget', () => {
  type Slot = Parameters<typeof resolveGeminiVoiceTarget>[0];
  const slot = (extra: Record<string, unknown>): Slot => ({
    active: 'SystemTTS',
    config: {},
    ...extra,
  });

  it('GeminiTTS activo: toma config', () => {
    const s = slot({ active: 'GeminiTTS', config: { voice_id: 'v1', base_url: 'http://x' } });
    expect(resolveGeminiVoiceTarget(s)).toEqual({ voiceId: 'v1', baseUrl: 'http://x' });
  });

  it('GeminiTTS en la cadena: toma providers.GeminiTTS', () => {
    const s = slot({ fallback_chain: ['GeminiTTS'], providers: { GeminiTTS: { voice_id: 'v2' } } });
    expect(resolveGeminiVoiceTarget(s)).toEqual({ voiceId: 'v2', baseUrl: undefined });
  });

  it('GeminiTTS ausente: undefined', () => {
    expect(resolveGeminiVoiceTarget(slot({ fallback_chain: ['ElevenLabsTTS'] }))).toBeUndefined();
    expect(resolveGeminiVoiceTarget(slot({}))).toBeUndefined();
  });

  it('voice_id que no es string: undefined', () => {
    const s = slot({ active: 'GeminiTTS', config: { voice_id: 42 } });
    expect(resolveGeminiVoiceTarget(s)?.voiceId).toBeUndefined();
  });
});
