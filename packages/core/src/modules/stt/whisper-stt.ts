/**
 * WhisperSTT — cliente HTTP del microservicio Python con faster-whisper.
 *
 * Su rol es **acotado** (ver ADR 0019, decisión 8):
 *
 * - `ping()` — healthcheck que el bootstrap del core-host usa al
 *   arrancar para advertir si el micro no responde. Mismo patrón que
 *   `LettaMemory.ping()`. Nunca lanza.
 * - `transcribe(request)` — llamada batch contra `POST /transcribe`.
 *   Pensada para tests/CLI o invocaciones programáticas; **NO** es el
 *   flujo del chat en tiempo real. Ese va por WebSocket directo desde
 *   el cliente desktop al microservicio (ADR 0019, decisión 3).
 *
 * Browser-safe: usa `fetch` global. El tipo `Buffer` aparece en la
 * interfaz `ISTTModule.transcribe` pero solo como anotación de tipo —
 * `Buffer` extiende `Uint8Array`, así que `fetch` lo acepta tal cual
 * como `body`. Esta clase nunca se instancia en el cliente desktop;
 * vive en core para que el core-host la registre en el bootstrap.
 *
 * Notas de diseño:
 *
 * - El idioma fijo viene del servicio (`WHISPER_LANGUAGE`); el campo
 *   `request.language` se ignora con un `warn` si difiere. En V2 podría
 *   añadirse `?language=` al endpoint y propagarse aquí.
 * - El microservicio espera PCM Int16 LE mono al sample_rate configurado
 *   (default 16 kHz). El caller es responsable de pasar audio en ese
 *   formato — esta capa no resamplea ni convierte.
 */

import { z } from 'zod';
import type { ISTTModule, STTRequest, STTResult } from '../../interfaces/ISTTModule.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const WhisperSTTConfigSchema = z.object({
  /** URL base del microservicio Python. Default `http://localhost:8765`. */
  service_url: z.string().url().default('http://localhost:8765'),
  /**
   * Idioma ISO 639-1 que se espera del servicio. Hoy solo se usa para
   * detectar mismatches con `request.language`; el servicio fija el suyo
   * vía `WHISPER_LANGUAGE`. Si difieren, se loguea un warn.
   */
  language: z.string().default('es'),
  /**
   * Silencio sostenido (ms) que el cliente desktop usa para cerrar turno
   * en modo hands-free (VAD). Vive en esta config para que esté en un
   * solo sitio del YAML; el cliente lee este valor por el bus.
   */
  vad_silence_ms: z.number().int().positive().default(800),
  /**
   * Timeout HTTP en ms. Default 30s — un `transcribe()` batch en GPU
   * con `small` tarda <2s para 30s de audio; en CPU con `medium` puede
   * acercarse al minuto. 30s cubre el caso GPU cómodo y deja margen.
   */
  timeout_ms: z.number().int().positive().default(30_000),
});

export type WhisperSTTConfig = z.infer<typeof WhisperSTTConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class WhisperSTTError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WhisperSTTError';
    this.status = status;
  }
}

// ─── Schemas de las respuestas del microservicio ──────────────────────

const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'loading']),
  model: z.string(),
  device: z.string().optional(),
  language: z.string().optional(),
  sample_rate: z.number().optional(),
});

const TranscribeResponseSchema = z.object({
  text: z.string(),
  isFinal: z.boolean(),
});

// ─── Implementación ───────────────────────────────────────────────────

export class WhisperSTT implements ISTTModule {
  readonly id: string;
  private readonly config: WhisperSTTConfig;
  private readonly logger: Logger;

  constructor(rawConfig: unknown, deps: ModuleDeps) {
    const parsed = WhisperSTTConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new WhisperSTTError(
        `WhisperSTT: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.logger = deps.logger.child({ module: 'WhisperSTT' });
    this.id = 'stt:whisper';
  }

  /** URL base normalizada (sin slash final). Útil para tests/inspección. */
  get serviceUrl(): string {
    return this.config.service_url.replace(/\/$/, '');
  }

  /**
   * Healthcheck del microservicio (`GET /health`). Devuelve `true` solo
   * si responde 2xx con `status: "ok"` (modelo cargado). `loading`, 5xx,
   * timeout y red caída → `false`. Nunca lanza — el bootstrap lo usa
   * para advertir, no para abortar.
   */
  async ping(): Promise<boolean> {
    const url = `${this.serviceUrl}/health`;
    try {
      const res = await this.fetchWithTimeout(url, { method: 'GET' });
      if (!res.ok) {
        this.logger.debug(`ping: ${res.status} ${res.statusText}`);
        return false;
      }
      const raw: unknown = await res.json();
      const parsed = HealthResponseSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.debug(`ping: /health con shape inesperado — ${parsed.error.message}`);
        return false;
      }
      if (parsed.data.status !== 'ok') {
        this.logger.debug(`ping: status="${parsed.data.status}" (modelo aún cargando)`);
        return false;
      }
      // Aviso útil si el cliente y el servicio difieren de idioma — el
      // servicio gana, pero queremos verlo en logs para que el usuario
      // sepa por qué su `language: 'en'` en YAML no tuvo efecto.
      if (parsed.data.language !== undefined && parsed.data.language !== this.config.language) {
        this.logger.warn(
          `ping: idioma del servicio "${parsed.data.language}" != config "${this.config.language}". ` +
            `Cámbialo en WHISPER_LANGUAGE del microservicio si lo quieres alineado.`,
        );
      }
      return true;
    } catch (err) {
      this.logger.debug(`ping falló: ${String(err)}`);
      return false;
    }
  }

  /**
   * Transcripción batch contra `POST /transcribe`. Pensada para
   * tests/CLI — el chat en vivo no pasa por aquí.
   */
  async transcribe(request: STTRequest): Promise<STTResult> {
    if (request.language !== undefined && request.language !== this.config.language) {
      this.logger.warn(
        `transcribe: language="${request.language}" ignorado en V1 ` +
          `(el servicio fija "${this.config.language}" vía WHISPER_LANGUAGE)`,
      );
    }

    const url = `${this.serviceUrl}/transcribe`;
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        // `Buffer` extiende `Uint8Array`, así que `fetch` lo acepta
        // como body sin conversión. En builds browser donde `Buffer`
        // no exista en runtime, esta clase no se instancia.
        body: request.audio,
      });
    } catch (err) {
      throw new WhisperSTTError(`WhisperSTT: fallo al llamar a ${url}`, undefined, err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '<sin cuerpo>');
      throw new WhisperSTTError(
        `WhisperSTT: ${res.status} ${res.statusText} — ${text}`,
        res.status,
      );
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch (err) {
      throw new WhisperSTTError('WhisperSTT: respuesta no es JSON', res.status, err);
    }

    const parsed = TranscribeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new WhisperSTTError(
        `WhisperSTT: respuesta con shape inesperado — ${parsed.error.message}`,
        res.status,
      );
    }
    return { text: parsed.data.text, isFinal: parsed.data.isFinal };
  }

  // ─── Internas ───────────────────────────────────────────────────────

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
