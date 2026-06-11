/**
 * system-health — chequeo server-side de los servicios externos y la
 * presencia de las API keys, para alimentar el setup wizard del cliente
 * (ADR 0024 §6).
 *
 * **Por qué server-side**: el `core-host` (sidecar) tiene acceso de red
 * directo a Ollama/Letta/Whisper y conoce `process.env`. Si el webview
 * intentara estos fetches, chocaría con CORS (Ollama y Letta no emiten
 * cabeceras CORS para el origin del cliente). El sidecar chequea y emite
 * el reporte por el bus; el cliente solo lo renderiza.
 *
 * **Nunca expone el valor de las keys** — solo su presencia (boolean).
 */

import type {
  Logger,
  ModulesConfig,
  ServiceStatus,
  SystemHealthReport,
} from '@proyecto-shiro/core';

/** URLs base de los tres servicios externos a chequear. */
export interface HealthTargets {
  ollamaUrl: string;
  lettaUrl: string;
  whisperUrl: string;
}

const DEFAULT_OLLAMA = 'http://localhost:11434';
const DEFAULT_LETTA = 'http://localhost:8283';
const DEFAULT_WHISPER = 'http://localhost:8765';
const DEFAULT_TIMEOUT_MS = 2_500;

/**
 * Extrae las URLs de los servicios de la config validada, con fallback a
 * los defaults. El `config` de cada slot es `Record<string, unknown>`
 * (cada módulo valida el suyo), así que leemos defensivamente.
 */
export function resolveHealthTargets(config: ModulesConfig): HealthTargets {
  const llmLocal = config.modules.llm.local.config;
  const memory = config.modules.memory.config;
  const stt = config.modules.stt.config;

  const lettaCfg =
    memory !== undefined && typeof memory.letta === 'object' && memory.letta !== null
      ? (memory.letta as Record<string, unknown>)
      : undefined;

  return {
    ollamaUrl: readString(llmLocal?.host, DEFAULT_OLLAMA),
    lettaUrl: readString(lettaCfg?.base_url, DEFAULT_LETTA),
    whisperUrl: readString(stt?.service_url, DEFAULT_WHISPER),
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Presencia (no el valor) de las API keys en el entorno del proceso. */
export function readSecretPresence(): SystemHealthReport['secrets'] {
  return {
    anthropic: hasEnv('ANTHROPIC_API_KEY'),
    elevenlabs: hasEnv('ELEVENLABS_API_KEY'),
  };
}

function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

export interface CheckSystemHealthOptions extends HealthTargets {
  /** Timeout por servicio en ms. Default 2500. */
  timeoutMs?: number;
  logger?: Logger;
  /** Inyectable para tests. Default `fetch` global. */
  fetchImpl?: typeof fetch;
}

/**
 * Chequea los tres servicios + lee la presencia de keys y arma el reporte.
 * Nunca lanza — un servicio caído resuelve a `'down'`, no a una excepción.
 */
export async function checkSystemHealth(
  options: CheckSystemHealthOptions,
): Promise<SystemHealthReport> {
  const { ollamaUrl, lettaUrl, whisperUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.logger?.child({ module: 'SystemHealth' });

  const probe = (base: string, path: string): Promise<ServiceStatus> =>
    probeService(fetchImpl, `${base.replace(/\/$/, '')}${path}`, timeoutMs, log);

  // Los tres en paralelo — el chequeo entero tarda como mucho `timeoutMs`.
  const [ollama, letta, whisper] = await Promise.all([
    probe(ollamaUrl, '/api/tags'),
    probe(lettaUrl, '/v1/health/'),
    probe(whisperUrl, '/health'),
  ]);

  return {
    services: { ollama, letta, whisper },
    secrets: readSecretPresence(),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * GET a `url` con timeout. `'ok'` solo si responde 2xx; `'down'` ante
 * cualquier no-2xx, timeout o error de red. Nunca lanza.
 */
async function probeService(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  log: Logger | undefined,
): Promise<ServiceStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    if (res.ok) return 'ok';
    log?.debug(`${url} → ${String(res.status)} ${res.statusText}`);
    return 'down';
  } catch (err) {
    log?.debug(`${url} → ${err instanceof Error ? err.message : String(err)}`);
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
