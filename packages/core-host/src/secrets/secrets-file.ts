/**
 * secrets-file — persistencia de API keys para el binario empaquetado.
 *
 * En `npm run dev` las keys vienen del `.env` de la raíz (cargado por
 * `--env-file-if-exists`). Pero el binario Tauri no tiene un `.env` al
 * lado, así que el usuario las mete por el wizard de Setup → el `core-host`
 * las escribe a un `secrets.env` en su **cwd** (que en el sidecar es el
 * `app_local_data_dir`, fijado por el lanzador Tauri — ver ADR 0024 §2/§6).
 *
 * Al arrancar, `loadSecretsEnv` lee ese archivo y rellena `process.env`
 * **sin pisar** lo que ya esté (un `.env` o una env var real tienen
 * prioridad). Como los módulos LLM/TTS leen las keys al construirse, los
 * cambios aplican en el **siguiente arranque**, no en caliente.
 *
 * Formato: líneas `KEY=VALUE`. Solo gestionamos las keys de `MANAGED_KEYS`;
 * el archivo es nuestro, no un `.env` genérico.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SECRETS_FILENAME = 'secrets.env';

/** Las únicas keys que este módulo lee y escribe. */
export const MANAGED_KEYS = ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY'] as const;
export type ManagedKey = (typeof MANAGED_KEYS)[number];

/** Mapea el nombre corto del payload del bus a la env var real. */
export const SECRET_FIELD_TO_ENV: Record<string, ManagedKey> = {
  anthropic: 'ANTHROPIC_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
};

/** Parsea un contenido `KEY=VALUE` a un mapa (ignora líneas vacías/`#`). */
function parseEnvText(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out.set(key, value);
  }
  return out;
}

/**
 * Lee `<dir>/secrets.env` y rellena `process.env` con las MANAGED_KEYS que
 * tengan valor, **sin sobrescribir** las que ya estén definidas. No-op si
 * el archivo no existe. Devuelve los nombres de las keys que cargó (para
 * log/diagnóstico) — nunca los valores.
 */
export function loadSecretsEnv(dir: string): ManagedKey[] {
  const path = join(dir, SECRETS_FILENAME);
  if (!existsSync(path)) return [];
  let parsed: Map<string, string>;
  try {
    parsed = parseEnvText(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const loaded: ManagedKey[] = [];
  for (const key of MANAGED_KEYS) {
    const value = parsed.get(key);
    if (value === undefined || value === '') continue;
    const existing = process.env[key];
    if (typeof existing === 'string' && existing.trim() !== '') continue; // ya definida → respetar
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

/**
 * Escribe/actualiza `<dir>/secrets.env` con las keys provistas. Hace merge
 * con lo que ya hubiera: una key con string no vacío se setea; una con
 * string vacío se **borra**; una `undefined` se deja como estaba.
 *
 * Devuelve `true` si el archivo cambió respecto a su contenido previo
 * (para decidir `restartRequired`).
 */
export function saveSecretsEnv(dir: string, updates: Partial<Record<ManagedKey, string>>): boolean {
  const path = join(dir, SECRETS_FILENAME);
  const current = existsSync(path)
    ? parseEnvText(readFileSync(path, 'utf8'))
    : new Map<string, string>();
  const before = serialize(current);

  for (const key of MANAGED_KEYS) {
    const next = updates[key];
    if (next === undefined) continue; // no se tocó
    if (next.trim() === '') {
      current.delete(key); // vaciar = borrar
    } else {
      current.set(key, next.trim());
    }
  }

  const after = serialize(current);
  if (after === before) return false;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, after, { encoding: 'utf8', mode: 0o600 });
  return true;
}

/** Serializa el mapa a texto `KEY=VALUE` ordenado y estable. */
function serialize(map: Map<string, string>): string {
  const lines = MANAGED_KEYS.filter((k) => {
    const v = map.get(k);
    return v !== undefined && v !== '';
  }).map((k) => `${k}=${map.get(k) ?? ''}`);
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
