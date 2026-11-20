// @ts-check
/**
 * memory-backup.mjs — la parte de la copia de seguridad que se prueba sin red
 * (P-11a; apartado 8.1 del plan de mejora).
 *
 * `scripts/backup-homelab.ps1` lo llama para sacar la instantánea de
 * `memory.db`, escribir el manifiesto con los hashes, decidir qué copias
 * antiguas sobran y anotar la última copia correcta. El volcado de Letta, el
 * envío y el borrado en el destino los hace el script de PowerShell.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

/** Nombre de la carpeta de una copia: fecha y hora en UTC, ordenable como texto. */
export const BACKUP_NAME = /^\d{8}T\d{6}Z$/;
/** Nombre del volcado de Letta dentro de la copia. */
export const LETTA_DUMP = 'letta.dump';
/** Archivo que anota la última copia correcta, al lado de `memory.db`. */
export const LAST_BACKUP_FILE = 'last-backup.json';

/** @param {Date} date */
export function backupName(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

/**
 * ¿Sirve este Node? El addon de SQLite se compila para una versión mayor.
 *
 * @param {string} nodeVersion `process.versions.node`
 * @param {string} wanted versión mayor de `.node-version`
 * @returns {string | null} por qué no, o `null` si sirve
 */
export function checkNode(nodeVersion, wanted) {
  if (nodeVersion.split('.')[0] === wanted.trim()) return null;
  return (
    `la copia necesita Node ${wanted.trim()} (el de .node-version) y este es Node ${nodeVersion}. ` +
    'El addon de SQLite es de otra versión y no carga: cambia de Node y repite.'
  );
}

/**
 * Copia `memory.db` con la API de backup de SQLite, que es segura con la base
 * abierta y el WAL a medias; copiar el archivo a mano no lo es (R-329). El
 * origen se abre en solo lectura: aquí no se migra ni se escribe.
 *
 * @param {string} dbPath
 * @param {string} outFile
 */
export async function snapshotMemory(dbPath, outFile) {
  if (!existsSync(dbPath)) throw new Error(`no existe la base de la memoria: ${dbPath}`);
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(outFile);
  } finally {
    source.close();
  }
  // La copia queda en un solo archivo, sin `-wal` ni `-shm` al lado.
  const copy = new Database(outFile);
  try {
    copy.pragma('journal_mode = DELETE');
    return inspectMemory(copy);
  } finally {
    copy.close();
  }
}

/** @param {import('better-sqlite3').Database} db */
function inspectMemory(db) {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new Error(`la copia no pasa la comprobación de SQLite: ${String(integrity)}`);
  }
  const table = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'`)
    .get();
  if (table === undefined) {
    throw new Error('la base no tiene la tabla de turnos: no parece la memoria de Shiro');
  }
  const row =
    /** @type {{ turns: number, pending: number | null, first: string | null, last: string | null }} */ (
      db
        .prepare(
          `SELECT COUNT(*) AS turns, SUM(synced_at IS NULL) AS pending,
                MIN(timestamp) AS first, MAX(timestamp) AS last
         FROM messages`,
        )
        .get()
    );
  return {
    userVersion: Number(db.pragma('user_version', { simple: true })),
    turns: row.turns,
    pending: row.pending ?? 0,
    firstTurnAt: row.first,
    lastTurnAt: row.last,
  };
}

/** @param {string} path */
export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Modelos de `ollama list`, con el identificador corto de cada uno. Los pesos
 * no se copian (se vuelven a descargar): basta con saber cuáles eran.
 *
 * @param {string} text
 */
export function parseOllamaList(text) {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2)
    .map(([name, id]) => ({ name, id }));
}

/**
 * Filas por tabla del Postgres de Letta, de líneas `tabla=n`. Van en el
 * manifiesto para comparar al restaurar: un volcado no se puede contar sin
 * restaurarlo.
 *
 * @param {string} text
 */
export function parseRowCounts(text) {
  /** @type {Record<string, number>} */
  const rows = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\w+)=(\d+)$/.exec(line.trim());
    if (match?.[1] !== undefined) rows[match[1]] = Number(match[2]);
  }
  return rows;
}

/** La imagen de Letta fijada en `docker-compose.yml`. @param {string} text */
export function lettaImageFromCompose(text) {
  return /^\s*image:\s*(letta\/letta\S*)\s*$/m.exec(text)?.[1] ?? null;
}

/**
 * Qué copias sobran. Solo propone carpetas con nombre de copia: lo demás que
 * haya en el destino no se toca nunca.
 *
 * @param {string[]} names nombres que hay en la carpeta de destino
 * @param {number} keep cuántas copias se conservan
 */
export function planRotation(names, keep) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('hay que conservar al menos una copia');
  return names
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .reverse()
    .slice(keep);
}

/**
 * @param {{ dir: string, name: string, createdAt: string,
 *   memory: Awaited<ReturnType<typeof snapshotMemory>>,
 *   letta: { included: boolean, image: string | null, reason?: string,
 *     rows?: Record<string, number> | null },
 *   ollama: { name: string | undefined, id: string | undefined }[] | null }} input
 */
export async function buildManifest({ dir, name, createdAt, memory, letta, ollama }) {
  const names = ['memory.db', ...(letta.included ? [LETTA_DUMP] : [])];
  const files = [];
  for (const file of names) {
    const path = join(dir, file);
    if (!existsSync(path)) throw new Error(`falta ${file} en la copia`);
    files.push({ name: file, bytes: statSync(path).size, sha256: await sha256File(path) });
  }
  // Sin el volcado de Letta la copia vale, pero no es completa: se dice.
  return { format: 1, name, createdAt, complete: letta.included, files, memory, letta, ollama };
}

/**
 * Comprueba una copia contra su manifiesto. Devuelve lo que no cuadra.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function verifyBackup(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const problems = [];
  for (const file of manifest.files) {
    const path = join(dir, file.name);
    if (!existsSync(path)) problems.push(`falta ${file.name}`);
    else if ((await sha256File(path)) !== file.sha256) problems.push(`${file.name} no coincide`);
  }
  return problems;
}

/** @param {string[]} argv */
async function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      db: { type: 'string' },
      out: { type: 'string' },
      dir: { type: 'string' },
      name: { type: 'string' },
      keep: { type: 'string', default: '7' },
      'letta-image': { type: 'string' },
      'no-letta': { type: 'string' },
      'ollama-list': { type: 'string' },
      'letta-rows': { type: 'string' },
    },
  });
  const root = new URL('../../', import.meta.url);
  const need = (/** @type {string | undefined} */ value, /** @type {string} */ flag) => {
    if (value === undefined || value === '') throw new Error(`falta --${flag}`);
    return value;
  };

  if (command === 'name') return backupName(new Date());
  if (command === 'rotate') {
    const names = readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean);
    return planRotation(names, Number(values.keep)).join('\n');
  }
  if (command === 'verify') {
    const problems = await verifyBackup(need(values.dir, 'dir'));
    if (problems.length > 0) throw new Error(`la copia no cuadra: ${problems.join('; ')}`);
    return 'ok';
  }
  if (command === 'create') {
    const problem = checkNode(
      process.versions.node,
      readFileSync(new URL('.node-version', root), 'utf8'),
    );
    if (problem !== null) throw new Error(problem);
    const out = need(values.out, 'out');
    const name = need(values.name, 'name');
    mkdirSync(out, { recursive: true });
    const memory = await snapshotMemory(need(values.db, 'db'), join(out, 'memory.db'));
    const pinned = lettaImageFromCompose(readFileSync(new URL('docker-compose.yml', root), 'utf8'));
    const skipped = values['no-letta'];
    const manifest = await buildManifest({
      dir: out,
      name,
      createdAt: new Date().toISOString(),
      memory,
      letta:
        skipped === undefined
          ? {
              included: true,
              image: values['letta-image'] ?? pinned,
              rows:
                values['letta-rows'] === undefined
                  ? null
                  : parseRowCounts(readFileSync(values['letta-rows'], 'utf8')),
            }
          : { included: false, image: pinned, reason: skipped },
      ollama:
        values['ollama-list'] === undefined
          ? null
          : parseOllamaList(readFileSync(values['ollama-list'], 'utf8')),
    });
    writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return JSON.stringify({ name, turns: memory.turns, complete: manifest.complete });
  }
  if (command === 'mark') {
    const manifest = JSON.parse(
      readFileSync(join(need(values.dir, 'dir'), 'manifest.json'), 'utf8'),
    );
    const record = {
      at: new Date().toISOString(),
      name: manifest.name,
      complete: manifest.complete,
      turns: manifest.memory.turns,
    };
    const file = join(dirname(need(values.db, 'db')), LAST_BACKUP_FILE);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    return file;
  }
  throw new Error('uso: memory-backup.mjs name | create | verify | rotate | mark');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (output) => {
      console.log(output);
    },
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
