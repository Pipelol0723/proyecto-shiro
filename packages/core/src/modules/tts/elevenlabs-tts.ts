/**
 * ElevenLabsTTS — cliente del API REST de ElevenLabs.
 *
 * Implementa `ITTSModule`. Recibe `{ text, emotion?, voiceId? }`,
 * hace POST a `/v1/text-to-speech/{voice_id}` y devuelve el blob MP3
 * con su mimeType. Mapeo emoción → `stability` se calcula leyendo el
 * `emotions:` del character YAML pasado al constructor; el resto de
 * `voice_settings` (similarity_boost, style, use_speaker_boost) son
 * constantes por voz desde la config del módulo.
 *
 * Browser-safe: usa `fetch` global. **PERO** la API key vive en
 * `process.env.ELEVENLABS_API_KEY` (server-side) — por contrato esta
 * clase se instancia solo en el `core-host`, no en clientes browser.
 * El módulo no expone la key en ninguna respuesta.
 *
 * Ver [ADR 0020](../../../../docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)
 * para por qué este módulo es primary y SystemTTS único fallback,
 * y por qué corre in-process en lugar de microservicio aparte.
 *
 * Sobre la **duración** del audio (`TTSResponse.duration`): ElevenLabs
 * no la devuelve en headers ni en body. La dejamos `undefined` en V1;
 * el cliente que reproduce la mide post-fetch con `audioElement.
 * duration`. Añadir parseo MP3 server-side sería complejidad innecesaria
 * para un dato que el cliente puede calcular gratis.
 */

import { z } from 'zod';
import type { Character } from '../../character/schema.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import type { ITTSModule, TTSRequest, TTSResponse } from '../../interfaces/ITTSModule.js';
import type { Emotion } from '../../types/emotions.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const ElevenLabsTTSConfigSchema = z.object({
  /**
   * Voice ID de ElevenLabs. Obligatorio para sintetizar. Si llega vacío
   * el constructor lo acepta pero `synthesize()` lanza error legible al
   * llamarse — útil para que el bootstrap no muera por una config
   * incompleta y el usuario lo descubra al primer turno de voz.
   */
  voice_id: z.string().default(''),
  /** Modelo de ElevenLabs. Default `eleven_multilingual_v2`. */
  model_id: z.string().min(1).default('eleven_multilingual_v2'),
  /**
   * `voice_settings.similarity_boost`. 0-1. Mantiene la identidad de la
   * voz elegida — más alto es más fiel.
   */
  similarity_boost: z.number().min(0).max(1).default(0.78),
  /**
   * `voice_settings.style`. 0-1. Exageración del estilo. Bajo para Shiro
   * (kuudere — no exagera, ver ADR 0020).
   */
  style: z.number().min(0).max(1).default(0.15),
  /**
   * `voice_settings.use_speaker_boost`. Mejora la claridad sin tocar
   * timbre. Activarlo por defecto.
   */
  use_speaker_boost: z.boolean().default(true),
  /**
   * `voice_settings.stability` por defecto cuando no hay mapeo de
   * emoción en el character YAML, o la emoción es desconocida. ElevenLabs
   * recomienda 0.5 para narración general; nosotros tiramos un poco más
   * arriba (Shiro estable por naturaleza). El TTS lo lee del YAML
   * cuando el caller pasa `request.emotion`.
   */
  default_stability: z.number().min(0).max(1).default(0.75),
  /** URL base del API. Default oficial; expuesto para tests y proxies. */
  base_url: z.string().url().default('https://api.elevenlabs.io'),
  /** Timeout HTTP en ms. Default 30 s — frases cortas tardan <2 s en GPU/Cloud. */
  timeout_ms: z.number().int().positive().default(30_000),
});

export type ElevenLabsTTSConfig = z.infer<typeof ElevenLabsTTSConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class ElevenLabsTTSError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ElevenLabsTTSError';
    this.status = status;
  }
}

// ─── Opciones del constructor (deps + character) ──────────────────────

export interface ElevenLabsTTSOptions {
  /**
   * Mapeo `Emotion → { tts_stability }` que viene del character YAML
   * activo. Opcional: si no se pasa o no contiene la emoción del
   * request, el TTS usa `config.default_stability`. Mantiene el
   * acoplamiento al character explícito y testeable.
   */
  emotions?: Character['emotions'];
  /**
   * Override de la API key. Por defecto se lee de
   * `process.env.ELEVENLABS_API_KEY`. Tests inyectan aquí.
   */
  apiKey?: string;
}

// ─── Implementación ───────────────────────────────────────────────────

export class ElevenLabsTTS implements ITTSModule {
  readonly id: string;
  private readonly config: ElevenLabsTTSConfig;
  private readonly logger: Logger;
  private readonly emotions: Character['emotions'] | undefined;
  private readonly apiKey: string | undefined;

  constructor(rawConfig: unknown, deps: ModuleDeps, options: ElevenLabsTTSOptions = {}) {
    const parsed = ElevenLabsTTSConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new ElevenLabsTTSError(
        `ElevenLabsTTS: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.logger = deps.logger.child({ module: 'ElevenLabsTTS' });
    this.emotions = options.emotions;
    this.apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
    this.id = `tts:elevenlabs:${this.config.voice_id || '<sin-voice-id>'}`;

    if (this.apiKey === undefined || this.apiKey === '') {
      // No abortar el bootstrap — solo avisar. Si nadie llama
      // `synthesize` (porque el slot TTS está apagado o el caller usa
      // otro fallback), no hace falta key. Si llama, error legible.
      this.logger.warn(
        'ELEVENLABS_API_KEY no está definida. ElevenLabsTTS no podrá sintetizar hasta configurarla.',
      );
    }
    if (this.config.voice_id === '') {
      this.logger.warn(
        'ElevenLabsTTS: `voice_id` vacío en config. Define uno en `config/modules.config.yaml` ' +
          '(slot tts.config.voice_id) o sintetizar fallará en runtime.',
      );
    }
  }

  /**
   * URL base normalizada (sin slash final). Útil para tests/inspección.
   */
  get baseUrl(): string {
    return this.config.base_url.replace(/\/$/, '');
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (this.apiKey === undefined || this.apiKey === '') {
      throw new ElevenLabsTTSError(
        'ElevenLabsTTS: ELEVENLABS_API_KEY no está definida. Añádela al .env del core-host.',
      );
    }
    const voiceId = request.voiceId ?? this.config.voice_id;
    if (voiceId === '') {
      throw new ElevenLabsTTSError(
        'ElevenLabsTTS: voice_id vacío. Configura `tts.config.voice_id` en modules.config.yaml ' +
          'o pasa `voiceId` explícito en TTSRequest.',
      );
    }
    if (request.text.trim().length === 0) {
      throw new ElevenLabsTTSError('ElevenLabsTTS: el texto a sintetizar está vacío.');
    }

    const stability = this.resolveStability(request.emotion);
    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const body = {
      text: request.text,
      model_id: this.config.model_id,
      voice_settings: {
        stability,
        similarity_boost: this.config.similarity_boost,
        style: this.config.style,
        use_speaker_boost: this.config.use_speaker_boost,
      },
    };

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ElevenLabsTTSError(`ElevenLabsTTS: fallo al llamar a ${url}`, undefined, err);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '<sin cuerpo>');
      // Mensajes específicos para los errores más comunes — ayuda al
      // usuario a saber qué hacer en lugar de leer el JSON crudo.
      if (response.status === 401) {
        throw new ElevenLabsTTSError(
          'ElevenLabsTTS: 401 — ELEVENLABS_API_KEY rechazada. Verifica que la key sea válida.',
          401,
        );
      }
      if (response.status === 429) {
        throw new ElevenLabsTTSError(
          `ElevenLabsTTS: 429 — rate limit o cuota mensual agotada. Detalles: ${text}`,
          429,
        );
      }
      throw new ElevenLabsTTSError(
        `ElevenLabsTTS: ${response.status} ${response.statusText} — ${text}`,
        response.status,
      );
    }

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (err) {
      throw new ElevenLabsTTSError(
        'ElevenLabsTTS: no se pudo leer el cuerpo de la respuesta como bytes',
        response.status,
        err,
      );
    }
    if (arrayBuffer.byteLength === 0) {
      throw new ElevenLabsTTSError(
        'ElevenLabsTTS: respuesta vacía (0 bytes). El proveedor no devolvió audio.',
        response.status,
      );
    }

    return {
      audio: Buffer.from(arrayBuffer),
      mimeType: response.headers.get('Content-Type') ?? 'audio/mpeg',
    };
  }

  /**
   * Mapea la emoción del request a `stability` consultando el bloque
   * `emotions:` del character YAML. Si no hay match (sin emotions, sin
   * la clave concreta, o `tts_stability` undefined), cae al
   * `default_stability` de la config.
   */
  private resolveStability(emotion: Emotion | undefined): number {
    if (emotion === undefined) return this.config.default_stability;
    const mapping = this.emotions?.[emotion];
    if (mapping?.tts_stability === undefined) {
      return this.config.default_stability;
    }
    return mapping.tts_stability;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeout_ms);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}
