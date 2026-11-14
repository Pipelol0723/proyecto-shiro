/**
 * GeminiTTS — cliente del API de Interactions de Gemini (ADR 0034 §1, parte b-1).
 *
 * Implementa `ITTSModule`. Hace `POST {base_url}/interactions` y extrae el
 * primer contenido `audio` de `steps[].content[]`, tal como lo devuelve la API
 * real (forma capturada con una llamada real el 2026-11-13). Valida el audio
 * con `parseWav` y devuelve siempre `audio/wav` con su duración en ms.
 *
 * Esta parte no incluye estilo (`annotations`), guardas de entrada, tiempo
 * máximo efectivo ni contador de cuota: llegan en partes posteriores del ADR.
 * Los errores no reintentan nada (un 429 debe saltar a la cadena de respaldo).
 *
 * Por contrato se instancia solo en el `core-host`: la clave vive en
 * `process.env.GEMINI_API_KEY` y no aparece en errores ni en logs.
 */

import { z } from 'zod';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import type { ITTSModule, TTSRequest, TTSResponse } from '../../interfaces/ITTSModule.js';
import { parseWav } from './wav.js';

export const GeminiTTSConfigSchema = z.object({
  /** Identificador de la voz diseñada (`voice_…`). */
  voice_id: z.string().min(1),
  /** Modelo de síntesis. */
  model_id: z.string().min(1).default('gemini-3.8-flash-tts'),
  /** URL base del API. Existe solo para inyectar un servidor falso en tests. */
  base_url: z
    .string()
    .url()
    .refine(isPlainHttpUrl, 'debe ser http(s) sin credenciales ni query')
    .default('https://generativelanguage.googleapis.com/v1beta'),
  /** Timeout HTTP en ms. Su uso real llega en 2b-2. */
  timeout_ms: z.number().int().positive().default(30_000),
});

export type GeminiTTSConfig = z.infer<typeof GeminiTTSConfigSchema>;

export class GeminiTTSError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GeminiTTSError';
    this.status = status;
  }
}

export interface GeminiTTSOptions {
  /** Override de la clave. Por defecto `process.env.GEMINI_API_KEY`. */
  apiKey?: string;
}

const ERROR_BODY_MAX = 200;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** http(s) sin usuario, contraseña ni query: así la URL nunca porta secretos. */
function isPlainHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      u.username === '' &&
      u.password === '' &&
      u.search === ''
    );
  } catch {
    return false;
  }
}

/** Sustituye cada aparición de los secretos (en crudo y escapados como JSON). */
function redact(input: string, secrets: string[]): string {
  let out = input;
  for (const secret of secrets) {
    if (secret === '') continue;
    const escaped = JSON.stringify(secret).slice(1, -1);
    for (const variant of new Set([secret, escaped])) {
      out = out.split(variant).join('[redactado]');
    }
  }
  return out;
}

/** Forma mínima de la respuesta: solo lo que se lee. */
interface InteractionResponse {
  steps?: { content?: { type?: string; data?: string }[] }[];
}

export class GeminiTTS implements ITTSModule {
  readonly id: string;
  private readonly config: GeminiTTSConfig;
  private readonly logger: Logger;
  private readonly apiKey: string | undefined;

  constructor(rawConfig: unknown, deps: ModuleDeps, options: GeminiTTSOptions = {}) {
    const parsed = GeminiTTSConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new GeminiTTSError(
        `GeminiTTS: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.logger = deps.logger.child({ module: 'GeminiTTS' });
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    this.id = `tts:gemini:${this.config.voice_id}`;
    if (this.apiKey === undefined || this.apiKey === '') {
      this.logger.warn(
        'GEMINI_API_KEY no está definida. GeminiTTS no podrá sintetizar hasta configurarla.',
      );
    }
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (this.apiKey === undefined || this.apiKey === '') {
      throw new GeminiTTSError('GeminiTTS: GEMINI_API_KEY no está definida.');
    }
    const url = `${this.config.base_url.replace(/\/$/, '')}/interactions`;
    const body = {
      model: this.config.model_id,
      input: [{ type: 'user_input', content: [{ type: 'text', text: request.text }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: this.config.voice_id }] },
    };

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new GeminiTTSError(
        `GeminiTTS: fallo al llamar a ${new URL(url).origin}`,
        undefined,
        err,
      );
    }

    if (!response.ok) {
      const rawDetail = await response.text().catch(() => '<sin cuerpo>');
      // Se redacta antes de recortar para no dejar un trozo de la clave en el borde.
      const detail = redact(rawDetail, [this.apiKey, request.text]).slice(0, ERROR_BODY_MAX);
      if (response.status === 401) {
        throw new GeminiTTSError('GeminiTTS: 401 — GEMINI_API_KEY rechazada.', 401);
      }
      if (response.status === 429) {
        throw new GeminiTTSError(
          `GeminiTTS: 429 — cuota agotada o límite de peticiones. Detalles: ${detail}`,
          429,
        );
      }
      throw new GeminiTTSError(`GeminiTTS: ${response.status} — ${detail}`, response.status);
    }

    let json: InteractionResponse;
    try {
      json = (await response.json()) as InteractionResponse;
    } catch (err) {
      throw new GeminiTTSError('GeminiTTS: la respuesta no es JSON', response.status, err);
    }
    const base64 = extractAudioBase64(json);
    if (base64 === undefined) {
      throw new GeminiTTSError('GeminiTTS: la respuesta no trae audio', response.status);
    }
    if (!BASE64_RE.test(base64)) {
      throw new GeminiTTSError('GeminiTTS: el audio no es base64 válido', response.status);
    }
    const audio = Buffer.from(base64, 'base64');
    try {
      const info = parseWav(audio);
      return { audio, mimeType: 'audio/wav', duration: info.durationMs };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'motivo desconocido';
      throw new GeminiTTSError(
        `GeminiTTS: el audio no es un WAV válido — ${reason}`,
        undefined,
        err,
      );
    }
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

/** Primer contenido `audio` con `data` dentro de `steps[].content[]`. */
function extractAudioBase64(json: InteractionResponse): string | undefined {
  for (const step of json.steps ?? []) {
    for (const item of step.content ?? []) {
      if (item.type === 'audio' && typeof item.data === 'string' && item.data !== '') {
        return item.data;
      }
    }
  }
  return undefined;
}
