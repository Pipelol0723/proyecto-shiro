/**
 * gemini-voice-check — caducidad de la voz diseñada de Gemini (ADR 0034 §5).
 *
 * Las voces diseñadas caducan al año. Este módulo consulta
 * `GET {base}/voices/{id}` y deriva un estado; el bootstrap lo lanza UNA vez
 * al arrancar, en segundo plano, y reutiliza el resultado: el aviso por log
 * es, por tanto, solo al arrancar.
 *
 * Nunca lanza: sin clave, sin `voice_id`, error de red, tiempo agotado o
 * respuesta ilegible dan `unknown`. La respuesta real pesa ~2 MB por el audio
 * de muestra (`sample_audio`): solo se lee `expire_time`, y ni la respuesta ni
 * la clave se registran ni se devuelven.
 */

import type { GeminiVoiceStatus, ModulesConfig } from '@proyecto-shiro/core';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Por debajo de estos días completos la voz se considera «por caducar». */
const EXPIRING_DAYS = 30;

export interface CheckGeminiVoiceOptions {
  apiKey: string | undefined;
  voiceId: string | undefined;
  /** Por defecto, el API público de Gemini. */
  baseUrl?: string;
  /** Inyectable para tests. Default `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Reloj inyectable para tests. */
  now?: Date;
  /** Tiempo máximo de la consulta. Default 5000 ms. */
  timeoutMs?: number;
}

const UNKNOWN: GeminiVoiceStatus = { status: 'unknown' };

export async function checkGeminiVoice(
  options: CheckGeminiVoiceOptions,
): Promise<GeminiVoiceStatus> {
  const apiKey = options.apiKey?.trim() ?? '';
  const voiceId = options.voiceId?.trim() ?? '';
  if (apiKey === '' || voiceId === '') return { ...UNKNOWN };

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}/voices/${encodeURIComponent(voiceId)}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { ...UNKNOWN };
    const body = (await res.json()) as { expire_time?: unknown } | null;
    return statusFromExpireTime(body?.expire_time, now);
  } catch {
    return { ...UNKNOWN };
  } finally {
    clearTimeout(timer);
  }
}

function statusFromExpireTime(raw: unknown, now: Date): GeminiVoiceStatus {
  if (typeof raw !== 'string') return { ...UNKNOWN };
  const expiresMs = Date.parse(raw); // admite RFC 3339 con nueve decimales
  if (Number.isNaN(expiresMs)) return { ...UNKNOWN };
  const expiresAt = new Date(expiresMs).toISOString();
  const remainingMs = expiresMs - now.getTime();
  if (remainingMs <= 0) return { status: 'expired', expiresAt };
  const daysLeft = Math.floor(remainingMs / DAY_MS);
  return { status: daysLeft < EXPIRING_DAYS ? 'expiring' : 'ok', expiresAt, daysLeft };
}

/** Datos de GeminiTTS necesarios para consultar su voz. */
export interface GeminiVoiceTarget {
  voiceId: string | undefined;
  baseUrl: string | undefined;
}

/**
 * Localiza la config de `GeminiTTS` en el slot `tts`: `config` si es el módulo
 * activo, `providers.GeminiTTS` si es un respaldo de la cadena. `undefined` si
 * `GeminiTTS` no participa (entonces no se hace ninguna petición).
 */
export function resolveGeminiVoiceTarget(
  slot: ModulesConfig['modules']['tts'],
): GeminiVoiceTarget | undefined {
  let cfg: Record<string, unknown> | undefined;
  if (slot.active === 'GeminiTTS') {
    cfg = slot.config;
  } else if (slot.fallback_chain?.includes('GeminiTTS') === true) {
    cfg = slot.providers?.GeminiTTS;
  } else {
    return undefined;
  }
  const voiceId = cfg?.voice_id;
  const baseUrl = cfg?.base_url;
  return {
    voiceId: typeof voiceId === 'string' ? voiceId : undefined,
    baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined,
  };
}
