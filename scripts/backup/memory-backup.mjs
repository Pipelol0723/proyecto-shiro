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
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { rmSync, statSync, writeFileSync } from 'node:fs';
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
 * origen se abre en solo lectura: aquí no se migra ni se escribe. Si algo
 * falla, no se deja una copia a medias.
 *
 * @param {string} dbPath
 * @param {string} outFile
 */
export async function snapshotMemory(dbPath, outFile) {
  if (!existsSync(dbPath)) throw new Error(`no existe la base de la memoria: ${dbPath}`);
  try {
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
  } catch (err) {
    rmSync(outFile, { force: true });
    throw err;
  }
}

/** @param {import('better-sqlite3').Database} db */
function inspectMemory(db) {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new Error(`la copia no pasa la comprobación de SQLite: ${String(integrity)}`);
  }
  const columns = /** @type {{ name: string }[]} */ (db.pragma('table_info(messages)')).map(
    (column) => column.name,
  );
  if (columns.length === 0) {
    throw new Error('la base no tiene la tabla de turnos: no parece la memoria de Shiro');
  }
  // Una base de un esquema anterior también se copia: lo que no tenga, no se cuenta.
  const pending = columns.includes('synced_at') ? 'SUM(synced_at IS NULL)' : 'NULL';
  const row =
    /** @type {{ turns: number, pending: number | null, first: string | null, last: string | null }} */ (
      db
        .prepare(
          `SELECT COUNT(*) AS turns, ${pending} AS pending,
                  MIN(timestamp) AS first, MAX(timestamp) AS last
           FROM messages`,
        )
        .get()
    );
  return {
    userVersion: Number(db.pragma('user_version', { simple: true })),
    turns: row.turns,
    pending: row.pending,
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
 * no se copian (se vuelven a descargar): basta con saber cuáles eran. `null`
 * si el texto no trae ninguno: un error de Ollama no es una lista vacía.
 *
 * @param {string} text
 */
export function parseOllamaList(text) {
  const models = text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2)
    .map(([name, id]) => ({ name, id }));
  return models.length > 0 ? models : null;
}

/**
 * Filas por tabla del Postgres de Letta, de líneas `tabla=n`. Van en el
 * manifiesto para comparar al restaurar: un volcado no se puede contar sin
 * restaurarlo. `null` si el texto no trae ningún recuento.
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
  return Object.keys(rows).length > 0 ? rows : null;
}

/** La imagen de Letta fijada en `docker-compose.yml`. @param {string} text */
export function lettaImageFromCompose(text) {
  return /^\s*image:\s*(letta\/letta\S*)\s*$/m.exec(text)?.[1] ?? null;
}

/**
 * Las copias que hay en el destino, de líneas `nombre=completa` o
 * `nombre=parcial`. Lo que no sea eso (otra carpeta, una copia sin manifiesto,
 * una línea repetida) no cuenta como copia.
 *
 * @param {string} text
 */
export function parseCopies(text) {
  /** @type {Map<string, boolean>} */
  const copies = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [name = '', state] = line.trim().split('=');
    if (BACKUP_NAME.test(name) && (state === 'completa' || state === 'parcial')) {
      copies.set(name, state === 'completa');
    }
  }
  return [...copies].map(([name, complete]) => ({ name, complete }));
}

/**
 * Qué copias sobran. Se conservan las `keep` más nuevas y, además, la última
 * completa: varias copias seguidas sin el volcado de Letta no pueden echar a
 * la única que lo lleva.
 *
 * @param {{ name: string, complete: boolean }[]} copies
 * @param {number} keep cuántas copias se conservan
 */
export function planRotation(copies, keep) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('hay que conservar al menos una copia');
  const sorted = [...new Map(copies.map((copy) => [copy.name, copy])).values()]
    .filter((copy) => BACKUP_NAME.test(copy.name))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  const lastComplete = sorted.find((copy) => copy.complete)?.name;
  return sorted
    .slice(keep)
    .map((copy) => copy.name)
    .filter((name) => name !== lastComplete);
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
    const bytes = statSync(path).size;
    // Un volcado que falló a medias deja un archivo vacío: no es una copia.
    if (bytes === 0) throw new Error(`${file} está vacío: la copia no se da por buena`);
    files.push({ name: file, bytes, sha256: await sha256File(path) });
  }
  // Sin el volcado de Letta la copia vale, pero no es completa: se dice.
  return { format: 1, name, createdAt, complete: letta.included, files, memory, letta, ollama };
}

/**
 * Lee un manifiesto y comprueba que tiene la forma de uno: una copia sin la
 * memoria, o que dice ser completa sin el volcado, no es una copia.
 *
 * @param {string} dir
 */
export function readManifest(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const names = files.map((/** @type {{ name?: unknown }} */ file) => file.name);
  if (names.some((/** @type {unknown} */ n) => typeof n !== 'string' || /[\\/]/.test(n))) {
    throw new Error('el manifiesto nombra un archivo que no está en la carpeta de la copia');
  }
  if (!names.includes('memory.db')) throw new Error('el manifiesto no incluye la memoria');
  if (manifest.complete === true && !names.includes(LETTA_DUMP)) {
    throw new Error('el manifiesto dice que la copia es completa y no incluye el volcado de Letta');
  }
  return manifest;
}

/**
 * Comprueba los archivos de una copia contra su manifiesto. Devuelve lo que no
 * cuadra. Solo mira los hashes: abrir la memoria y contar es del ensayo de
 * restauración.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function verifyBackup(dir) {
  const problems = [];
  for (const file of readManifest(dir).files) {
    const path = join(dir, file.name);
    if (!existsSync(path)) problems.push(`falta ${file.name}`);
    else if ((await sha256File(path)) !== file.sha256) problems.push(`${file.name} no coincide`);
  }
  return problems;
}

/**
 * El ensayo de restauración de la memoria: además de los hashes, abre la
 * memoria copiada, le pasa la comprobación de SQLite y cuenta los turnos. Se
 * abre en solo lectura: la carpeta de la copia no cambia.
 *
 * @param {string} dir
 */
export async function checkBackup(dir) {
  const problems = await verifyBackup(dir);
  if (problems.length > 0) throw new Error(`la copia no cuadra: ${problems.join('; ')}`);
  const manifest = readManifest(dir);
  const db = new Database(join(dir, 'memory.db'), { readonly: true, fileMustExist: true });
  let memory;
  try {
    memory = inspectMemory(db);
  } finally {
    db.close();
  }
  if (memory.turns !== manifest.memory?.turns) {
    throw new Error(
      `la memoria copiada tiene ${String(memory.turns)} turnos y el manifiesto dice ${String(manifest.memory?.turns)}`,
    );
  }
  const rows = manifest.letta?.rows;
  return {
    name: manifest.name,
    complete: manifest.complete === true,
    turns: memory.turns,
    lettaImage: manifest.letta?.image ?? null,
    lettaTables: rows ? Object.keys(rows).length : null,
  };
}

/**
 * Compara las filas por tabla que había al copiar con las que hay al
 * restaurar. Devuelve lo que no coincide, tabla por tabla.
 *
 * @param {Record<string, number>} copied
 * @param {Record<string, number>} restored
 */
export function compareRows(copied, restored) {
  const problems = [];
  for (const table of new Set([...Object.keys(copied), ...Object.keys(restored)])) {
    const before = copied[table];
    const after = restored[table];
    if (before === after) continue;
    if (before === undefined) {
      problems.push(`${table}: no estaba en la copia y hay ${String(after)} al restaurar`);
    } else if (after === undefined) {
      problems.push(`${table}: ${String(before)} en la copia y no está al restaurar`);
    } else {
      problems.push(`${table}: ${String(before)} en la copia y ${String(after)} al restaurar`);
    }
  }
  return problems.sort();
}

/**
 * Anota la copia en `last-backup.json`, al lado de la memoria. Una copia sin
 * el volcado de Letta también se anota, pero conserva la fecha de la última
 * completa: son dos avisos distintos.
 *
 * @param {string} dbPath
 * @param {string} dir carpeta de la copia, con su manifiesto
 * @param {Date} now
 */
export function markLastBackup(dbPath, dir, now) {
  const manifest = readManifest(dir);
  const file = join(dirname(dbPath), LAST_BACKUP_FILE);
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // Sin anotación previa, o ilegible: se empieza de cero.
  }
  const at = now.toISOString();
  const earlier = typeof previous?.lastCompleteAt === 'string' ? previous.lastCompleteAt : null;
  const record = {
    at,
    name: manifest.name,
    complete: manifest.complete === true,
    turns: manifest.memory.turns,
    lastCompleteAt: manifest.complete === true ? at : earlier,
  };
  // Se escribe aparte y se renombra: un corte a medias no deja el archivo roto.
  writeFileSync(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return file;
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
      'letta-rows': { type: 'string' },
      'no-letta': { type: 'string' },
      'ollama-list': { type: 'string' },
      'allow-empty': { type: 'boolean', default: false },
      rows: { type: 'string' },
    },
  });
  const root = new URL('../../', import.meta.url);
  const need = (/** @type {string | undefined} */ value, /** @type {string} */ flag) => {
    if (value === undefined || value === '') throw new Error(`falta --${flag}`);
    return value;
  };
  const text = (/** @type {string | undefined} */ file) =>
    file === undefined ? '' : readFileSync(file, 'utf8');

  if (command === 'name') return backupName(new Date());
  if (command === 'rotate') {
    return planRotation(parseCopies(readFileSync(0, 'utf8')), Number(values.keep)).join('\n');
  }
  if (command === 'verify') {
    const problems = await verifyBackup(need(values.dir, 'dir'));
    if (problems.length > 0) throw new Error(`la copia no cuadra: ${problems.join('; ')}`);
    return 'ok';
  }
  if (command === 'mark') {
    return markLastBackup(need(values.db, 'db'), need(values.dir, 'dir'), new Date());
  }
  if (command === 'check') return JSON.stringify(await checkBackup(need(values.dir, 'dir')));
  if (command === 'compare-rows') {
    const copied = readManifest(need(values.dir, 'dir')).letta?.rows;
    const restored = parseRowCounts(text(need(values.rows, 'rows')));
    if (restored === null) throw new Error('no se pudieron contar las filas de la base restaurada');
    if (!copied) {
      return 'la copia no lleva el recuento de filas: se restauró, pero no hay con qué comparar';
    }
    const problems = compareRows(copied, restored);
    if (problems.length > 0) {
      throw new Error(`la base restaurada no coincide con la copia:\n${problems.join('\n')}`);
    }
    const total = Object.values(restored).reduce((sum, n) => sum + n, 0);
    return `${String(Object.keys(restored).length)} tablas, ${String(total)} filas: igual que en la copia`;
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
    if (memory.turns === 0 && !values['allow-empty']) {
      rmSync(join(out, 'memory.db'), { force: true });
      throw new Error(
        'la memoria no tiene ningún turno: ¿es la base correcta? No se da por copiada ' +
          '(con --allow-empty se copia igual)',
      );
    }
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
              rows: parseRowCounts(text(values['letta-rows'])),
            }
          : { included: false, image: pinned, reason: skipped },
      ollama: parseOllamaList(text(values['ollama-list'])),
    });
    writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return JSON.stringify({ name, turns: memory.turns, complete: manifest.complete });
  }
  throw new Error(
    'uso: memory-backup.mjs name | create | verify | rotate | mark | check | compare-rows',
  );
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
