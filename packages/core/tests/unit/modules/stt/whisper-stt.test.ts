/**
 * Tests del WhisperSTT — cliente HTTP del microservicio Python con
 * faster-whisper. Mockean `fetch` global; nunca tocan red real.
 *
 * Cubren:
 * - Validación del schema de config.
 * - `ping()` con cada uno de los caminos: ok, loading, 5xx, red caída,
 *   shape inesperado.
 * - `transcribe()` con buffer, shape correcto, 5xx, fetch que rechaza,
 *   respuesta no-JSON, mismatch de idioma.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import {
  WhisperSTT,
  WhisperSTTConfigSchema,
  WhisperSTTError,
} from '../../../../src/modules/stt/whisper-stt.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

/** Mini-stub de `Response` que cubre solo lo que `WhisperSTT` lee. */
function mockResponse(
  body: unknown,
  init: { status?: number; statusText?: string; ok?: boolean } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('WhisperSTTConfigSchema', () => {
  it('aplica defaults cuando el input está vacío', () => {
    const cfg = WhisperSTTConfigSchema.parse({});
    expect(cfg.service_url).toBe('http://localhost:8765');
    expect(cfg.language).toBe('es');
    expect(cfg.vad_silence_ms).toBe(800);
    expect(cfg.timeout_ms).toBe(30_000);
  });

  it('rechaza service_url que no es URL', () => {
    expect(() => WhisperSTTConfigSchema.parse({ service_url: 'no-url' })).toThrow();
  });

  it('rechaza vad_silence_ms no positivo', () => {
    expect(() => WhisperSTTConfigSchema.parse({ vad_silence_ms: 0 })).toThrow();
    expect(() => WhisperSTTConfigSchema.parse({ vad_silence_ms: -1 })).toThrow();
  });
});

describe('WhisperSTT', () => {
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructor lanza WhisperSTTError con config inválida', () => {
    expect(() => new WhisperSTT({ service_url: 'no-url' }, makeDeps())).toThrow(WhisperSTTError);
  });

  it('id es estable "stt:whisper"', () => {
    const stt = new WhisperSTT({}, makeDeps());
    expect(stt.id).toBe('stt:whisper');
  });

  it('serviceUrl normaliza el slash final', () => {
    const stt = new WhisperSTT({ service_url: 'http://localhost:8765/' }, makeDeps());
    expect(stt.serviceUrl).toBe('http://localhost:8765');
  });

  describe('ping()', () => {
    it('devuelve true cuando /health responde status="ok"', async () => {
      fetchSpy.mockResolvedValue(
        mockResponse({
          status: 'ok',
          model: 'small',
          device: 'cuda',
          language: 'es',
          sample_rate: 16000,
        }),
      );
      const stt = new WhisperSTT({}, makeDeps());
      expect(await stt.ping()).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('http://localhost:8765/health');
      expect(init?.method).toBe('GET');
    });

    it('devuelve false cuando /health responde status="loading"', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ status: 'loading', model: 'small' }));
      const stt = new WhisperSTT({}, makeDeps());
      expect(await stt.ping()).toBe(false);
    });

    it('devuelve false cuando fetch rechaza (red caída, timeout)', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const stt = new WhisperSTT({}, makeDeps());
      expect(await stt.ping()).toBe(false);
    });

    it('devuelve false con respuesta 5xx', async () => {
      fetchSpy.mockResolvedValue(
        mockResponse({ detail: 'boom' }, { ok: false, status: 500, statusText: 'Server Error' }),
      );
      const stt = new WhisperSTT({}, makeDeps());
      expect(await stt.ping()).toBe(false);
    });

    it('devuelve false si /health tiene shape inesperado', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ status: 'weird' }));
      const stt = new WhisperSTT({}, makeDeps());
      expect(await stt.ping()).toBe(false);
    });
  });

  describe('transcribe()', () => {
    it('llama a POST /transcribe con el buffer como body y devuelve el texto', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ text: 'hola mundo', isFinal: true }));
      const stt = new WhisperSTT({ service_url: 'http://x:1234' }, makeDeps());
      const audio = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

      const result = await stt.transcribe({ audio });

      expect(result).toEqual({ text: 'hola mundo', isFinal: true });
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('http://x:1234/transcribe');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
        'application/octet-stream',
      );
      // El body es el mismo Buffer pasado (sin re-encoding).
      expect(init?.body).toBe(audio);
    });

    it('lanza WhisperSTTError con status 5xx', async () => {
      fetchSpy.mockResolvedValue(
        mockResponse({ detail: 'model unloaded' }, { ok: false, status: 503, statusText: 'SU' }),
      );
      const stt = new WhisperSTT({}, makeDeps());
      const audio = Buffer.alloc(4);

      const err = await stt.transcribe({ audio }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WhisperSTTError);
      expect((err as WhisperSTTError).status).toBe(503);
    });

    it('lanza WhisperSTTError si fetch rechaza', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const stt = new WhisperSTT({}, makeDeps());
      await expect(stt.transcribe({ audio: Buffer.alloc(4) })).rejects.toBeInstanceOf(
        WhisperSTTError,
      );
    });

    it('lanza WhisperSTTError si la respuesta no es JSON', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('not json'),
      } as Response);
      const stt = new WhisperSTT({}, makeDeps());
      await expect(stt.transcribe({ audio: Buffer.alloc(4) })).rejects.toBeInstanceOf(
        WhisperSTTError,
      );
    });

    it('lanza WhisperSTTError si la respuesta tiene shape inesperado', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ unexpected: 'shape' }));
      const stt = new WhisperSTT({}, makeDeps());
      await expect(stt.transcribe({ audio: Buffer.alloc(4) })).rejects.toBeInstanceOf(
        WhisperSTTError,
      );
    });

    it('no aborta si se pasa language distinto al del servicio (solo loguea warn)', async () => {
      fetchSpy.mockResolvedValue(mockResponse({ text: 'hi', isFinal: true }));
      const stt = new WhisperSTT({ language: 'es' }, makeDeps());

      const result = await stt.transcribe({ audio: Buffer.alloc(4), language: 'en' });
      expect(result.text).toBe('hi');
      expect(fetchSpy).toHaveBeenCalledOnce(); // se llamó igual
    });
  });
});
