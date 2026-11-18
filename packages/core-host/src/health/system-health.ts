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
  GeminiVoiceStatus,
  Logger,
  ModulesConfig,
  ServiceReadiness,
  ServiceStatus,
  SystemHealthReport,
} from '@proyecto-shiro/core';
import { HybridRouterConfigSchema, OllamaLLMConfigSchema } from '@proyecto-shiro/core';
import { LettaMemoryConfigSchema } from '@proyecto-shiro/core/node';

/** URLs base de los tres servicios externos a chequear. */
export interface HealthTargets {
  ollamaUrl: string;
  lettaUrl: string;
  whisperUrl: string;
  /** Modelos que la configuración espera encontrar en Ollama, sin repetir. */
  ollamaModels: string[];
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

  const ollamaUrl = readString(llmLocal?.host, DEFAULT_OLLAMA);
  return {
    ollamaUrl,
    lettaUrl: readString(lettaCfg?.base_url, DEFAULT_LETTA),
    whisperUrl: readString(stt?.service_url, DEFAULT_WHISPER),
    ollamaModels: expectedOllamaModels(config, ollamaUrl, lettaCfg),
  };
}

const OLLAMA_PREFIX = 'ollama/';

/**
 * Modelos que la configuración espera encontrar en el Ollama de `ollamaUrl`.
 *
 * Cada slot se lee con el esquema de su módulo, para exigir también los
 * modelos que se usan por defecto sin estar escritos en el YAML. Solo cuentan
 * los slots que de verdad usan ese Ollama: avisar de que «falta» un modelo que
 * nadie usa, o que vive en otro servidor, es peor que no avisar.
 */
function expectedOllamaModels(
  config: ModulesConfig,
  ollamaUrl: string,
  lettaCfg: Record<string, unknown> | undefined,
): string[] {
  const { llm, router, memory } = config.modules;
  const models: string[] = [];

  if (llm.local.active === 'OllamaLLM') {
    const parsed = OllamaLLMConfigSchema.safeParse(llm.local.config ?? {});
    if (parsed.success) models.push(parsed.data.model);
  }
  if (router.active === 'HybridRouter') {
    const parsed = HybridRouterConfigSchema.safeParse(router.config ?? {});
    if (parsed.success && sameOllama(parsed.data.classifier_host, ollamaUrl)) {
      models.push(parsed.data.classifier_model);
    }
  }
  // Letta usa Ollama para los embeddings y como modelo de su agente. Su
  // endpoint está escrito desde dentro del contenedor (host.docker.internal).
  if (memory.active === 'MemoryManager' && lettaCfg !== undefined) {
    const parsed = LettaMemoryConfigSchema.safeParse(lettaCfg);
    if (parsed.success && sameOllama(parsed.data.embedding_endpoint, ollamaUrl)) {
      models.push(parsed.data.embedding_model);
      if (parsed.data.model.startsWith(OLLAMA_PREFIX)) {
        models.push(parsed.data.model.slice(OLLAMA_PREFIX.length));
      }
    }
  }
  return [...new Set(models)];
}

/** Nombres con los que se llega a esta misma máquina, también desde Docker. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

/** `true` si las dos URLs apuntan al mismo servidor de Ollama. */
function sameOllama(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    if (portOf(x) !== portOf(y)) return false;
    return (
      x.hostname === y.hostname || (LOCAL_HOSTS.has(x.hostname) && LOCAL_HOSTS.has(y.hostname))
    );
  } catch {
    return false;
  }
}

function portOf(url: URL): string {
  if (url.port !== '') return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Presencia (no el valor) de las API keys en el entorno del proceso. */
export function readSecretPresence(): SystemHealthReport['secrets'] {
  return {
    anthropic: hasEnv('ANTHROPIC_API_KEY'),
    elevenlabs: hasEnv('ELEVENLABS_API_KEY'),
    gemini: hasEnv('GEMINI_API_KEY'),
  };
}

function hasEnv(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

export interface CheckSystemHealthOptions extends Omit<HealthTargets, 'ollamaModels'> {
  /** Modelos que Ollama debe tener. Sin lista no se comprueba ninguno. */
  ollamaModels?: readonly string[];
  /** Timeout por servicio en ms. Default 2500. */
  timeoutMs?: number;
  logger?: Logger;
  /** Inyectable para tests. Default `fetch` global. */
  fetchImpl?: typeof fetch;
  /**
   * Estado de la voz de Gemini ya consultado al arrancar (ADR 0034 §5). Se
   * copia tal cual al informe; aquí no se vuelve a consultar.
   */
  geminiVoice?: GeminiVoiceStatus;
  /** Lo que se sabe de la clave de la nube por los turnos (`watchCloudKey`). */
  cloudIssue?: ServiceReadiness['cloud'];
}

/**
 * Chequea los tres servicios + lee la presencia de keys y arma el reporte.
 * Nunca lanza — un servicio caído resuelve a `'down'`, no a una excepción.
 *
 * De Ollama y de Whisper lee además el cuerpo de la respuesta, para distinguir
 * vivo de listo (`readiness`). Si el cuerpo no se puede leer, el servicio
 * cuenta como vivo y no se afirma nada más.
 */
export async function checkSystemHealth(
  options: CheckSystemHealthOptions,
): Promise<SystemHealthReport> {
  const { ollamaUrl, lettaUrl, whisperUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.logger?.child({ module: 'SystemHealth' });

  const probe = (base: string, path: string): Promise<ProbeResult> =>
    probeService(fetchImpl, `${base.replace(/\/$/, '')}${path}`, timeoutMs, log);

  // Los tres en paralelo — el chequeo entero tarda como mucho `timeoutMs`.
  const [ollama, letta, whisper] = await Promise.all([
    probe(ollamaUrl, '/api/tags'),
    probe(lettaUrl, '/v1/health/'),
    probe(whisperUrl, '/health'),
  ]);

  const readiness: ServiceReadiness = {};
  const missing = missingOllamaModels(ollama.body, options.ollamaModels ?? []);
  if (missing.length > 0) readiness.ollamaMissingModels = missing;
  const whisperState = whisperReadiness(whisper.body);
  if (whisperState !== undefined) readiness.whisper = whisperState;
  if (options.cloudIssue !== undefined) readiness.cloud = options.cloudIssue;

  return {
    services: { ollama: ollama.status, letta: letta.status, whisper: whisper.status },
    secrets: readSecretPresence(),
    ...(options.geminiVoice !== undefined && { geminiVoice: options.geminiVoice }),
    ...(Object.keys(readiness).length > 0 && { readiness }),
    checkedAt: new Date().toISOString(),
  };
}

/** Resultado de un chequeo: si responde y, cuando se pudo leer, su cuerpo JSON. */
interface ProbeResult {
  status: ServiceStatus;
  body?: unknown;
}

/**
 * Modelos de `wanted` que no aparecen en la respuesta de `/api/tags`
 * (`{ models: [{ name }] }`). Ollama lista siempre con etiqueta, así que un
 * modelo pedido sin etiqueta vale con su `:latest`. La etiqueta se busca tras
 * la última barra: un registro con puerto (`host:5000/ns/modelo`) no la tiene.
 * Si la respuesta no tiene la forma esperada devuelve `[]`: no se inventa que
 * falte nada.
 */
function missingOllamaModels(body: unknown, wanted: readonly string[]): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const names = new Set(
    models
      .map((m: unknown) =>
        typeof m === 'object' && m !== null ? (m as { name?: unknown }).name : undefined,
      )
      .filter((name): name is string => typeof name === 'string'),
  );
  const hasTag = (model: string): boolean => model.slice(model.lastIndexOf('/') + 1).includes(':');
  return wanted.filter(
    (model) => !names.has(model) && !(!hasTag(model) && names.has(`${model}:latest`)),
  );
}

/** Estado de Whisper según su `/health`: cargando el modelo, o en CPU. */
function whisperReadiness(body: unknown): ServiceReadiness['whisper'] {
  if (typeof body !== 'object' || body === null) return undefined;
  const { status, device } = body as { status?: unknown; device?: unknown };
  if (status === 'loading') return 'loading';
  if (device === 'cpu') return 'cpu';
  return undefined;
}

/**
 * GET a `url` con timeout. `'ok'` solo si responde 2xx; `'down'` ante
 * cualquier no-2xx, timeout o error de red. Nunca lanza. Con un 2xx intenta
 * leer el cuerpo como JSON; si no puede, lo deja sin cuerpo.
 */
async function probeService(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  log: Logger | undefined,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      log?.debug(`${url} → ${String(res.status)} ${res.statusText}`);
      return { status: 'down' };
    }
    try {
      const body: unknown = await res.json();
      return { status: 'ok', body };
    } catch {
      return { status: 'ok' };
    }
  } catch (err) {
    log?.debug(`${url} → ${err instanceof Error ? err.message : String(err)}`);
    return { status: 'down' };
  } finally {
    clearTimeout(timer);
  }
}
