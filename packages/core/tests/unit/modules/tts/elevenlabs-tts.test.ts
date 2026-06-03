/**
 * Tests del ElevenLabsTTS — cliente HTTP del API de ElevenLabs.
 * Mockean `fetch` global; nunca tocan red real.
 *
 * Cubren:
 * - Validación del schema de config.
 * - Construcción con/sin API key (warn no abortando bootstrap).
 * - `synthesize()` con shape de request correcto (URL, headers, body).
 * - Mapeo emoción → stability desde el character `emotions`.
 * - Errores 401, 429, 5xx con mensajes legibles.
 * - Body vacío del proveedor, fetch que rechaza, respuesta 0 bytes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import {
  ElevenLabsTTS,
  ElevenLabsTTSConfigSchema,
  ElevenLabsTTSError,
} from '../../../../src/modules/tts/elevenlabs-tts.js';
import type { Character } from '../../../../src/character/schema.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

/** Mock de Response que cubre lo que `ElevenLabsTTS.synthesize` lee. */
function mockResponse(
  body: ArrayBuffer | string | { error?: string },
  init: { status?: number; statusText?: string; ok?: boolean; contentType?: string } = {},
): Response {
  const headers = new Map<string, string>([['Content-Type', init.contentType ?? 'audio/mpeg']]);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { get: (key: string) => headers.get(key) ?? null } as Headers,
    arrayBuffer: () => Promise.resolve(body instanceof ArrayBuffer ? body : new ArrayBuffer(0)),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

/** Buffer no vacío para tests. 128 bytes de "audio" simulado. */
function makeAudioBuffer(): ArrayBuffer {
  return new ArrayBuffer(128);
}

const CHARACTER_EMOTIONS: Character['emotions'] = {
  neutral: { tts_stability: 0.75 },
  divertida: { tts_stability: 0.65 },
  pensativa: { tts_stability: 0.82 },
  molesta: { tts_stability: 0.88 },
  vulnerable: { tts_stability: 0.55 },
};

describe('ElevenLabsTTSConfigSchema', () => {
  it('aplica defaults sensatos cuando el input está vacío', () => {
    const cfg = ElevenLabsTTSConfigSchema.parse({});
    expect(cfg.voice_id).toBe('');
    expect(cfg.model_id).toBe('eleven_multilingual_v2');
    expect(cfg.similarity_boost).toBe(0.78);
    expect(cfg.style).toBe(0.15);
    expect(cfg.use_speaker_boost).toBe(true);
    expect(cfg.default_stability).toBe(0.75);
    expect(cfg.base_url).toBe('https://api.elevenlabs.io');
    expect(cfg.timeout_ms).toBe(30_000);
  });

  it('rechaza similarity_boost fuera de [0, 1]', () => {
    expect(() => ElevenLabsTTSConfigSchema.parse({ similarity_boost: 1.5 })).toThrow();
  });

  it('rechaza style fuera de [0, 1]', () => {
    expect(() => ElevenLabsTTSConfigSchema.parse({ style: -0.1 })).toThrow();
  });

  it('rechaza default_stability fuera de [0, 1]', () => {
    expect(() => ElevenLabsTTSConfigSchema.parse({ default_stability: 2 })).toThrow();
  });

  it('rechaza base_url que no es URL', () => {
    expect(() => ElevenLabsTTSConfigSchema.parse({ base_url: 'no-url' })).toThrow();
  });
});

describe('ElevenLabsTTS', () => {
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
  const originalEnv = process.env.ELEVENLABS_API_KEY;

  beforeEach(() => {
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv === undefined) {
      delete process.env.ELEVENLABS_API_KEY;
    } else {
      process.env.ELEVENLABS_API_KEY = originalEnv;
    }
  });

  it('constructor no aborta cuando falta API key — solo warn', () => {
    expect(() => new ElevenLabsTTS({ voice_id: 'abc' }, makeDeps())).not.toThrow();
  });

  it('constructor lanza ElevenLabsTTSError con config inválida', () => {
    expect(() => new ElevenLabsTTS({ style: 2 }, makeDeps())).toThrow(ElevenLabsTTSError);
  });

  it('id incluye el voice_id', () => {
    const tts = new ElevenLabsTTS({ voice_id: 'abc123' }, makeDeps(), { apiKey: 'fake' });
    expect(tts.id).toBe('tts:elevenlabs:abc123');
  });

  it('baseUrl normaliza el slash final', () => {
    const tts = new ElevenLabsTTS(
      { voice_id: 'v', base_url: 'https://api.elevenlabs.io/' },
      makeDeps(),
      { apiKey: 'fake' },
    );
    expect(tts.baseUrl).toBe('https://api.elevenlabs.io');
  });

  describe('synthesize()', () => {
    it('lanza si la API key no está definida', async () => {
      const tts = new ElevenLabsTTS({ voice_id: 'abc' }, makeDeps());
      await expect(tts.synthesize({ text: 'hola' })).rejects.toThrow(/ELEVENLABS_API_KEY/);
    });

    it('lanza si voice_id está vacío y no se pasa override en request', async () => {
      const tts = new ElevenLabsTTS({}, makeDeps(), { apiKey: 'fake' });
      await expect(tts.synthesize({ text: 'hola' })).rejects.toThrow(/voice_id vacío/);
    });

    it('lanza si el texto está vacío', async () => {
      const tts = new ElevenLabsTTS({ voice_id: 'abc' }, makeDeps(), { apiKey: 'fake' });
      await expect(tts.synthesize({ text: '   ' })).rejects.toThrow(/texto.*vacío/);
    });

    it('llama al endpoint con el shape correcto', async () => {
      fetchSpy.mockResolvedValue(mockResponse(makeAudioBuffer()));
      const tts = new ElevenLabsTTS({ voice_id: 'voice-123' }, makeDeps(), {
        apiKey: 'sk-test',
      });
      await tts.synthesize({ text: 'hola Shiro' });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-123');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['xi-api-key']).toBe('sk-test');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Accept).toBe('audio/mpeg');

      const body = JSON.parse(init?.body as string) as {
        text: string;
        model_id: string;
        voice_settings: Record<string, number | boolean>;
      };
      expect(body.text).toBe('hola Shiro');
      expect(body.model_id).toBe('eleven_multilingual_v2');
      expect(body.voice_settings).toEqual({
        stability: 0.75, // default_stability sin emoción
        similarity_boost: 0.78,
        style: 0.15,
        use_speaker_boost: true,
      });
    });

    it('respeta voice_id del request por encima del config', async () => {
      fetchSpy.mockResolvedValue(mockResponse(makeAudioBuffer()));
      const tts = new ElevenLabsTTS({ voice_id: 'default-v' }, makeDeps(), {
        apiKey: 'fake',
      });
      await tts.synthesize({ text: 'hola', voiceId: 'override-v' });

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toContain('/override-v');
      expect(url).not.toContain('/default-v');
    });

    it('mapea la emoción a stability según el character', async () => {
      fetchSpy.mockResolvedValue(mockResponse(makeAudioBuffer()));
      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps(), {
        apiKey: 'fake',
        emotions: CHARACTER_EMOTIONS,
      });
      await tts.synthesize({ text: 'estoy molesta', emotion: 'molesta' });

      const [, init] = fetchSpy.mock.calls[0]!;
      const body = JSON.parse(init?.body as string) as {
        voice_settings: { stability: number };
      };
      expect(body.voice_settings.stability).toBe(0.88);
    });

    it('cae a default_stability si la emoción no está mapeada', async () => {
      fetchSpy.mockResolvedValue(mockResponse(makeAudioBuffer()));
      const tts = new ElevenLabsTTS({ voice_id: 'v', default_stability: 0.6 }, makeDeps(), {
        apiKey: 'fake',
        emotions: { neutral: { tts_stability: 0.75 } },
      });
      // Pedimos `pensativa` pero el character solo tiene `neutral`.
      await tts.synthesize({ text: 'mmm', emotion: 'pensativa' });

      const [, init] = fetchSpy.mock.calls[0]!;
      const body = JSON.parse(init?.body as string) as {
        voice_settings: { stability: number };
      };
      expect(body.voice_settings.stability).toBe(0.6);
    });

    it('devuelve el buffer y mimeType del response', async () => {
      const audio = makeAudioBuffer();
      fetchSpy.mockResolvedValue(mockResponse(audio));
      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps(), { apiKey: 'fake' });
      const res = await tts.synthesize({ text: 'hola' });

      expect(res.audio).toBeInstanceOf(Buffer);
      expect(res.audio.byteLength).toBe(128);
      expect(res.mimeType).toBe('audio/mpeg');
    });

    it('mensaje específico para 401 (API key rechazada)', async () => {
      fetchSpy.mockResolvedValue(
        mockResponse({ error: 'unauthorized' }, { ok: false, status: 401, statusText: 'U' }),
      );
      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps(), { apiKey: 'bad-key' });
      const err = await tts.synthesize({ text: 'hola' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ElevenLabsTTSError);
      expect((err as ElevenLabsTTSError).status).toBe(401);
      expect((err as Error).message).toContain('ELEVENLABS_API_KEY rechazada');
    });

    it('mensaje específico para 429 (rate limit / cuota)', async () => {
      fetchSpy.mockResolvedValue(
        mockResponse({ error: 'quota_exceeded' }, { ok: false, status: 429, statusText: 'TM' }),
      );
      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps(), { apiKey: 'fake' });
      const err = await tts.synthesize({ text: 'hola' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ElevenLabsTTSError);
      expect((err as ElevenLabsTTSError).status).toBe(429);
      expect((err as Error).message).toContain('rate limit o cuota');
    });

    it('lanza ElevenLabsTTSError genérico para 5xx', async () => {
      fetchSpy.mockResolvedValue(
        mockResponse({ error: 'boom' }, { ok: false, status: 500, statusText: 'Server Error' }),
      );
      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps(), { apiKey: 'fake' });
      const err = await tts.synthesize({ text: 'hola' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ElevenLabsTTSError);
      expect((err as ElevenLabsTTSError).status).toBe(500);
    });

    it('lanza ElevenLabsTTSError si fetch rechaza (red caída)', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps(), { apiKey: 'fake' });
      await expect(tts.synthesize({ text: 'hola' })).rejects.toBeInstanceOf(ElevenLabsTTSError);
    });

    it('lanza si la respuesta tiene 0 bytes', async () => {
      fetchSpy.mockResolvedValue(mockResponse(new ArrayBuffer(0)));
      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps(), { apiKey: 'fake' });
      await expect(tts.synthesize({ text: 'hola' })).rejects.toThrow(/0 bytes/);
    });

    it('lee la API key de process.env si no se pasa override', async () => {
      process.env.ELEVENLABS_API_KEY = 'env-key';
      fetchSpy.mockResolvedValue(mockResponse(makeAudioBuffer()));

      const tts = new ElevenLabsTTS({ voice_id: 'v' }, makeDeps()); // sin options.apiKey
      await tts.synthesize({ text: 'hola' });

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers['xi-api-key']).toBe('env-key');
    });

    it('encodea el voice_id en la URL (caracteres seguros)', async () => {
      fetchSpy.mockResolvedValue(mockResponse(makeAudioBuffer()));
      const tts = new ElevenLabsTTS({ voice_id: 'voice with spaces' }, makeDeps(), {
        apiKey: 'fake',
      });
      await tts.synthesize({ text: 'hola' });
      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toContain('voice%20with%20spaces');
    });
  });
});
