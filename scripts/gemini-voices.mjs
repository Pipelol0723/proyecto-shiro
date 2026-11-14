// @ts-check
/**
 * gemini-voices.mjs — crea, lista y consulta voces de Gemini (ADR 0034 §5).
 *
 * La voz de Shiro se diseña por descripción y caduca al año: la receta vive
 * aquí, en el repo, para recrearla sin depender de peticiones hechas a mano.
 *
 * Subcomandos:
 *   create [--yes] [--dry-run] [--name <nombre>]  crea una voz con la receta.
 *       Consume cuota y una voz recreada puede sonar distinta: exige --yes.
 *       --dry-run muestra el cuerpo de la petición sin llamar a nadie.
 *   list [--all]   lista las voces propias (--all añade las de catálogo).
 *   get <id>       muestra una voz y los días que le quedan.
 *
 * Códigos de salida: 0 correcto · 1 voz caducada, inexistente (404) o con menos
 * de 30 días (solo en `get`) · 2 error de uso, clave, red o API.
 *
 * La clave se lee solo de GEMINI_API_KEY (nunca de un .env) y nunca se imprime.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Receta de la voz «Precisa» (ADR 0034 §5). */
export const RECIPE = Object.freeze({
  model: 'gemini-3.8-flash-tts',
  type: 'prompted',
  gender: 'female',
  language: 'es-MX',
  displayName: 'shiro-precisa',
  description:
    'A cool, analytical young woman about 20 with a neutral Latin American Spanish accent. Clear, smooth mid-register voice with crisp articulation; deadpan and measured, with flat-to-falling intonation.',
});
/** Idiomas de respaldo, solo si Google responde 400 al anterior. */
export const LANGUAGE_FALLBACKS = ['es-MX', 'es-US', 'es-419', 'es'];
export const WARN_DAYS = 30;
const MAX_PAGES = 20;
const DAY_MS = 86_400_000;
const BOOLEAN_OPTIONS = new Set(['--yes', '--dry-run', '--all']);
const VALUE_OPTIONS = new Set(['--name']);

/**
 * @typedef {{ id: string, type: string, displayName: string, language: string, gender: string, expireTime?: string }} Voice
 * @typedef {{ fetch: typeof fetch, env: Record<string, string | undefined>, now: () => number, stdout: (s: string) => void, stderr: (s: string) => void }} Io
 */

/** Error de uso, de red o de la API; `status` es el HTTP si lo hubo. */
class VoicesError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Cuerpo de `POST /voices` con la receta.
 * @param {{ displayName?: string, language?: string }} options
 */
export function buildCreateBody({ displayName = RECIPE.displayName, language = RECIPE.language }) {
  return {
    store: true,
    voice: {
      model: RECIPE.model,
      type: RECIPE.type,
      display_name: displayName,
      gender: RECIPE.gender,
      language_code: language,
      prompted: { input: RECIPE.description },
    },
  };
}

/**
 * Reduce una voz de la API a lo que importa; descarta `sample_audio` (~2 MB).
 * @param {any} raw
 * @returns {Voice}
 */
export function parseVoice(raw) {
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
  return {
    id: text(raw?.id),
    type: text(raw?.type),
    displayName: text(raw?.display_name),
    language: text(raw?.language_code),
    gender: text(raw?.gender),
    ...(typeof raw?.expire_time === 'string' ? { expireTime: raw.expire_time } : {}),
  };
}

/**
 * Días enteros que quedan hasta `expireTime` (negativo si ya caducó), o `null`
 * si el valor no se entiende. Admite nueve decimales de segundo.
 * @param {unknown} expireTime RFC 3339 en UTC
 * @param {number} now milisegundos desde la época
 * @returns {number | null}
 */
export function daysLeft(expireTime, now) {
  if (typeof expireTime !== 'string') return null;
  // Se recortan los decimales a milisegundos: no todos los motores admiten más.
  const time = Date.parse(expireTime.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(time) ? null : Math.floor((time - now) / DAY_MS);
}

/**
 * @param {Io} io
 * @param {string} key
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function api(io, key, method, path, body) {
  const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
  const init =
    body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
  const res = await io.fetch(`${API_BASE}${path}`, init);
  /** @type {any} */
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Cuerpo vacío o que no es JSON: se informa más abajo según el estado.
  }
  if (!res.ok) {
    const detail = typeof data?.error?.message === 'string' ? `: ${data.error.message}` : '';
    throw new VoicesError(`la API respondió ${res.status}${detail}`, res.status);
  }
  if (!data || typeof data !== 'object') throw new VoicesError('la respuesta no es JSON');
  return data;
}

/** @param {Io} io @param {string} key @param {string[]} words @param {Set<string>} flags @param {Map<string, string>} values */
async function create(io, key, flags, values) {
  const displayName = values.get('--name') ?? RECIPE.displayName;
  if (flags.has('--dry-run')) {
    io.stdout(JSON.stringify(buildCreateBody({ displayName }), null, 2));
    return 0;
  }
  if (!flags.has('--yes')) {
    throw new VoicesError(
      'create consume cuota y una voz recreada puede sonar distinta: añade --yes (o prueba con --dry-run)',
    );
  }
  /** @type {VoicesError | undefined} */
  let last;
  for (const language of LANGUAGE_FALLBACKS) {
    try {
      const voice = parseVoice(
        await api(io, key, 'POST', '/voices', buildCreateBody({ displayName, language })),
      );
      io.stdout(
        `creada ${voice.id} (${voice.displayName}, ${voice.language}) caduca ${voice.expireTime ?? '?'}`,
      );
      io.stdout('Escúchala y cambia el voice_id a mano: la receta no garantiza el mismo timbre.');
      return 0;
    } catch (err) {
      if (!(err instanceof VoicesError) || err.status !== 400) throw err;
      last = err;
    }
  }
  throw last ?? new VoicesError('no se pudo crear la voz');
}

/** @param {Io} io @param {string} key @param {Set<string>} flags */
async function list(io, key, flags) {
  const all = flags.has('--all');
  /** @type {string | undefined} */
  let token;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = token ? `?pageToken=${encodeURIComponent(token)}` : '';
    const data = await api(io, key, 'GET', `/voices${query}`);
    const voices = Array.isArray(data.voices) ? data.voices.map(parseVoice) : [];
    for (const v of voices) {
      if (v.type === 'prebuilt' && !all) return 0; // las propias van primero
      const days = daysLeft(v.expireTime, io.now());
      io.stdout(
        `${v.id}\t${v.type}\t${v.language}\t${days === null ? '-' : `${days} días`}\t${v.displayName}`,
      );
    }
    token =
      typeof data.next_page_token === 'string' && data.next_page_token
        ? data.next_page_token
        : undefined;
    if (!token) return 0;
  }
  return 0;
}

/** @param {Io} io @param {string} key @param {string | undefined} id */
async function get(io, key, id) {
  if (!id) throw new VoicesError('get necesita el id de la voz');
  let voice;
  try {
    voice = parseVoice(await api(io, key, 'GET', `/voices/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err instanceof VoicesError && err.status === 404) {
      io.stderr(`gemini-voices: la voz ${id} no existe (o no hay permiso)`);
      return 1;
    }
    throw err;
  }
  const days = daysLeft(voice.expireTime, io.now());
  if (days === null)
    throw new VoicesError(`expire_time ilegible: ${JSON.stringify(voice.expireTime)}`);
  io.stdout(`${voice.id} ${voice.displayName} ${voice.language} ${voice.gender}`);
  io.stdout(`caduca ${voice.expireTime} (${days} días)`);
  if (days < 0) io.stderr(`gemini-voices: la voz ${id} está caducada`);
  else if (days < WARN_DAYS)
    io.stderr(`gemini-voices: a la voz ${id} le quedan ${days} días: recréala`);
  return days < WARN_DAYS ? 1 : 0;
}

/**
 * @param {string[]} argv
 * @param {Partial<Io>} [overrides] se inyectan en los tests
 * @returns {Promise<number>}
 */
export async function main(argv, overrides = {}) {
  /** @type {Io} */
  const io = {
    fetch: globalThis.fetch,
    env: process.env,
    now: Date.now,
    stdout: (s) => console.log(s),
    stderr: (s) => console.error(s),
    ...overrides,
  };
  const key = io.env.GEMINI_API_KEY ?? '';
  // Última red de seguridad: ningún mensaje sale con la clave dentro.
  const scrub = (/** @type {string} */ s) => (key ? s.split(key).join('[clave]') : s);
  const safe = {
    ...io,
    stdout: (/** @type {string} */ s) => io.stdout(scrub(s)),
    stderr: (/** @type {string} */ s) => io.stderr(scrub(s)),
  };
  try {
    /** @type {string[]} */
    const words = [];
    const flags = new Set();
    const values = new Map();
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (BOOLEAN_OPTIONS.has(arg)) flags.add(arg);
      else if (VALUE_OPTIONS.has(arg)) {
        const value = argv[++i];
        if (value === undefined || value.startsWith('--'))
          throw new VoicesError(`${arg} necesita un valor`);
        values.set(arg, value);
      } else if (arg.startsWith('--')) throw new VoicesError(`opción desconocida: ${arg}`);
      else words.push(arg);
    }
    const [command, id, ...extra] = words;
    if (!['create', 'list', 'get'].includes(command ?? '') || extra.length > 0) {
      throw new VoicesError(
        'uso: gemini-voices.mjs create|list|get <id> [--yes] [--dry-run] [--all] [--name <n>]',
      );
    }
    if (command === 'create' && flags.has('--dry-run'))
      return await create(safe, key, flags, values);
    if (!key) throw new VoicesError('falta la variable de entorno GEMINI_API_KEY');
    if (command === 'create') return await create(safe, key, flags, values);
    if (command === 'list') return await list(safe, key, flags);
    return await get(safe, key, id);
  } catch (err) {
    safe.stderr(`gemini-voices: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

/**
 * ¿Se ejecutó este archivo como programa? Con `realpath` en los dos lados:
 * Node resuelve los enlaces en `import.meta.url` pero no en `argv[1]`.
 */
function isMainModule() {
  try {
    const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
    return invoked === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await main(process.argv.slice(2));
}
