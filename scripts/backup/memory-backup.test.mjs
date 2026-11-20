// @ts-check
// Tests de la copia de seguridad de la memoria (P-11a). Se ejecutan con
// `npm run test:scripts`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  BACKUP_NAME,
  backupName,
  checkNode,
  lettaImageFromCompose,
  markLastBackup,
  parseCopies,
  parseOllamaList,
  parseRowCounts,
  planRotation,
  snapshotMemory,
  verifyBackup,
} from './memory-backup.mjs';

const CLI = fileURLToPath(new URL('./memory-backup.mjs', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'shiro-backup-test-'));
after(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Una memoria como la de Shiro, en modo WAL y con la conexión abierta. */
function openMemory(/** @type {string} */ path, turns = 3) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('user_version = 1');
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT, role TEXT, text TEXT,
    timestamp TEXT, metadata TEXT, synced_at TEXT)`);
  const insert = db.prepare(`INSERT INTO messages VALUES (?, 'me', 'user', ?, ?, NULL, ?)`);
  for (let i = 0; i < turns; i += 1) {
    const stamp = `2026-11-2${String(i)}T10:00:00.000Z`;
    insert.run(`t${String(i)}`, `turno ${String(i)}`, stamp, i === 0 ? 'x' : null);
  }
  return db;
}

/** Ejecuta la línea de comandos: código de salida, salida y error. */
function cli(/** @type {string[]} */ args, /** @type {string} */ input = '') {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

/** Argumentos de `create` para una base y una carpeta de este test. */
function createArgs(/** @type {string} */ db, /** @type {string} */ out) {
  return ['create', '--db', join(work, db), '--out', join(work, out), '--name', '20261120T083005Z'];
}

const copy = (/** @type {string} */ name, complete = false) => ({ name, complete });

test('el nombre de una copia es la fecha en UTC y se ordena como texto', () => {
  const name = backupName(new Date('2026-11-20T08:30:05.123Z'));
  assert.equal(name, '20261120T083005Z');
  assert.match(name, BACKUP_NAME);
});

test('solo sirve el Node de .node-version', () => {
  assert.equal(checkNode('22.13.1', '22\n'), null);
  assert.match(checkNode('24.1.0', '22\n') ?? '', /necesita Node 22/);
});

test('la instantánea lleva lo último que se escribió, con la base abierta y el WAL a medias', async () => {
  const source = join(work, 'abierta.db');
  const db = openMemory(source);
  assert.ok(existsSync(`${source}-wal`), 'la base de origen tiene el WAL sin volcar');

  const target = join(work, 'abierta-copia.db');
  const info = await snapshotMemory(source, target);
  db.close();

  assert.deepEqual(info, {
    userVersion: 1,
    turns: 3,
    pending: 2,
    firstTurnAt: '2026-11-20T10:00:00.000Z',
    lastTurnAt: '2026-11-22T10:00:00.000Z',
  });
  assert.equal(existsSync(`${target}-wal`), false, 'la copia es un solo archivo');
});

test('una base que no es la memoria de Shiro no se da por copiada ni deja restos', async () => {
  const other = join(work, 'otra.db');
  new Database(other).exec('CREATE TABLE cosas (id INTEGER)').close();
  const target = join(work, 'otra-copia.db');

  await assert.rejects(snapshotMemory(other, target), /no parece la memoria/);
  assert.equal(existsSync(target), false, 'no queda una copia a medias');
  await assert.rejects(snapshotMemory(join(work, 'no-existe.db'), target), /no existe/);
});

test('una memoria de un esquema anterior, sin la columna de sincronización, también se copia', async () => {
  const old = join(work, 'antigua.db');
  const db = new Database(old);
  db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, text TEXT, timestamp TEXT)');
  db.exec(`INSERT INTO messages VALUES ('a', 'hola', '2026-05-01T10:00:00.000Z')`);
  db.close();

  const info = await snapshotMemory(old, join(work, 'antigua-copia.db'));

  assert.deepEqual({ turns: info.turns, pending: info.pending }, { turns: 1, pending: null });
});

test('la rotación conserva las más nuevas y no toca lo que no es una copia', () => {
  const copies = Array.from({ length: 9 }, (_, i) => copy(`2026111${String(i)}T100000Z`));
  const strangers = [copy('notas.txt'), copy('20261101'), copy('20261120T100000Z.partial')];

  assert.deepEqual(planRotation([...copies, ...strangers], 7), [
    '20261111T100000Z',
    '20261110T100000Z',
  ]);
  assert.deepEqual(planRotation(copies.slice(0, 7), 7), []);
  assert.throws(() => planRotation(copies, 0), /al menos una/);
  assert.throws(() => planRotation(copies, Number.NaN), /al menos una/);
});

test('la rotación nunca echa a la última copia completa, por muchas parciales que haya después', () => {
  const copies = [
    copy('20261101T000000Z', true),
    copy('20261102T000000Z', true),
    copy('20261103T000000Z'),
    copy('20261104T000000Z'),
    copy('20261105T000000Z'),
  ];

  assert.deepEqual(planRotation(copies, 2), ['20261103T000000Z', '20261101T000000Z']);
});

test('una copia repetida en la lista no hace que se proponga borrar la única que hay', () => {
  assert.deepEqual(planRotation([copy('20261101T000000Z'), copy('20261101T000000Z')], 1), []);
});

test('del destino solo cuentan las carpetas con nombre de copia y con su manifiesto', () => {
  const text = [
    '20261101T000000Z=completa',
    '20261102T000000Z=parcial',
    '20261103T000000Z=sin-manifiesto',
    'otra-carpeta=parcial',
    '20261102T000000Z=parcial',
    '',
  ].join('\r\n');

  assert.deepEqual(parseCopies(text), [copy('20261101T000000Z', true), copy('20261102T000000Z')]);
});

test('lee los modelos de «ollama list», las filas de Letta y la imagen del compose', () => {
  const list =
    'NAME            ID              SIZE      MODIFIED\nqwen2.5:3b      357c53fb659c    1.9 GB    3 weeks ago\n\n';
  assert.deepEqual(parseOllamaList(list), [{ name: 'qwen2.5:3b', id: '357c53fb659c' }]);
  assert.deepEqual(parseRowCounts('agents=1\r\nmessages=42\n\nERROR: algo\nsin_numero=\n'), {
    agents: 1,
    messages: 42,
  });

  const compose = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(lettaImageFromCompose(compose) ?? '', /^letta\/letta@sha256:[0-9a-f]{64}$/);
});

test('un mensaje de error no es una lista vacía ni un recuento vacío', () => {
  assert.equal(parseOllamaList('Error: could not connect to ollama app\n'), null);
  assert.equal(parseRowCounts('psql: error: connection refused\n'), null);
  assert.equal(parseRowCounts(''), null);
});

test('crear, comprobar y anotar una copia sin el volcado de Letta', () => {
  const out = join(work, 'copia-sin-letta');
  openMemory(join(work, 'origen.db'), 5).close();
  writeFileSync(join(work, 'ollama.txt'), 'NAME ID SIZE MODIFIED\nqwen2.5:3b abc123 1.9 GB hoy\n');

  const created = cli([
    ...createArgs('origen.db', 'copia-sin-letta'),
    ...['--no-letta', 'Letta no estaba en marcha', '--ollama-list', join(work, 'ollama.txt')],
  ]);
  assert.deepEqual(JSON.parse(created.out), {
    name: '20261120T083005Z',
    turns: 5,
    complete: false,
  });

  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.complete, false);
  assert.deepEqual(
    manifest.files.map((/** @type {{ name: string }} */ file) => file.name),
    ['memory.db'],
  );
  assert.equal(manifest.letta.reason, 'Letta no estaba en marcha');
  assert.deepEqual(manifest.ollama, [{ name: 'qwen2.5:3b', id: 'abc123' }]);
  assert.deepEqual(cli(['verify', '--dir', out]), { code: 0, out: 'ok', err: '' });
});

test('con el volcado de Letta la copia es completa, y un archivo cambiado se detecta', async () => {
  const out = join(work, 'copia-completa');
  openMemory(join(work, 'origen2.db')).close();
  // El script de PowerShell deja el volcado en la carpeta antes de llamar.
  mkdirSync(out);
  writeFileSync(join(out, 'letta.dump'), 'volcado de prueba');
  writeFileSync(join(work, 'filas.txt'), 'agents=1\nmessages=42\n');

  const created = cli([
    ...createArgs('origen2.db', 'copia-completa'),
    ...['--letta-image', 'letta/letta@sha256:abc', '--letta-rows', join(work, 'filas.txt')],
  ]);

  assert.equal(JSON.parse(created.out).complete, true);
  assert.deepEqual(await verifyBackup(out), []);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.letta, {
    included: true,
    image: 'letta/letta@sha256:abc',
    rows: { agents: 1, messages: 42 },
  });

  appendFileSync(join(out, 'letta.dump'), '!');
  assert.deepEqual(await verifyBackup(out), ['letta.dump no coincide']);
  rmSync(join(out, 'memory.db'));
  assert.deepEqual(await verifyBackup(out), ['falta memory.db', 'letta.dump no coincide']);
  const failed = cli(['verify', '--dir', out]);
  assert.equal(failed.code, 1);
  assert.match(failed.err, /la copia no cuadra: falta memory\.db/);
});

test('una copia que dice llevar Letta falla si el volcado falta o está vacío', () => {
  openMemory(join(work, 'origen3.db')).close();

  const missing = cli(createArgs('origen3.db', 'sin-volcado'));
  assert.equal(missing.code, 1);
  assert.match(missing.err, /falta letta\.dump/);

  mkdirSync(join(work, 'volcado-vacio'));
  writeFileSync(join(work, 'volcado-vacio', 'letta.dump'), '');
  const empty = cli(createArgs('origen3.db', 'volcado-vacio'));
  assert.equal(empty.code, 1);
  assert.match(empty.err, /letta\.dump está vacío/);
  assert.equal(existsSync(join(work, 'volcado-vacio', 'manifest.json')), false);
});

test('una memoria sin ningún turno no se da por copiada, salvo que se pida', () => {
  openMemory(join(work, 'vacia.db'), 0).close();
  const args = [...createArgs('vacia.db', 'copia-vacia'), '--no-letta', 'x'];

  const refused = cli(args);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /no tiene ningún turno/);
  assert.equal(existsSync(join(work, 'copia-vacia', 'memory.db')), false);
  assert.equal(existsSync(join(work, 'copia-vacia', 'manifest.json')), false);

  const allowed = cli([...args, '--allow-empty']);
  assert.equal(allowed.code, 0, allowed.err);
  assert.equal(JSON.parse(allowed.out).turns, 0);
});

test('un manifiesto sin la memoria, o completo sin el volcado, no pasa por una copia', async () => {
  const dir = join(work, 'manifiestos');
  mkdirSync(dir);
  const write = (/** @type {unknown} */ manifest) => {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  };
  const memory = { name: 'memory.db', sha256: 'x' };

  write({ files: [] });
  await assert.rejects(verifyBackup(dir), /no incluye la memoria/);
  write({ complete: true, files: [memory] });
  await assert.rejects(verifyBackup(dir), /no incluye el volcado/);
  write({ files: [memory, { name: '../fuera.db', sha256: 'x' }] });
  await assert.rejects(verifyBackup(dir), /no está en la carpeta/);
  write({});
  assert.equal(cli(['verify', '--dir', dir]).code, 1);
});

test('la anotación guarda la última copia y conserva la fecha de la última completa', () => {
  const data = join(work, 'anotar');
  mkdirSync(data);
  const db = join(data, 'memory.db');
  const manifest = (/** @type {string} */ name, /** @type {boolean} */ complete) => {
    const dir = join(work, `anotar-${name}`);
    mkdirSync(dir);
    const files = [{ name: 'memory.db' }, ...(complete ? [{ name: 'letta.dump' }] : [])];
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ name, complete, files, memory: { turns: 7 } }),
    );
    return dir;
  };
  const read = () => JSON.parse(readFileSync(join(data, 'last-backup.json'), 'utf8'));

  markLastBackup(db, manifest('20261101T000000Z', true), new Date('2026-11-01T00:00:10.000Z'));
  assert.deepEqual(read(), {
    at: '2026-11-01T00:00:10.000Z',
    name: '20261101T000000Z',
    complete: true,
    turns: 7,
    lastCompleteAt: '2026-11-01T00:00:10.000Z',
  });

  markLastBackup(db, manifest('20261108T000000Z', false), new Date('2026-11-08T00:00:10.000Z'));
  assert.deepEqual(read(), {
    at: '2026-11-08T00:00:10.000Z',
    name: '20261108T000000Z',
    complete: false,
    turns: 7,
    lastCompleteAt: '2026-11-01T00:00:10.000Z',
  });
  assert.equal(existsSync(join(data, 'last-backup.json.tmp')), false);

  writeFileSync(join(data, 'last-backup.json'), '{ roto');
  markLastBackup(db, manifest('20261109T000000Z', false), new Date('2026-11-09T00:00:10.000Z'));
  assert.equal(read().lastCompleteAt, null);
});

test('la rotación por la línea de comandos lee las copias por la entrada', () => {
  const lines = [
    '20261101T000000Z=completa',
    '20261102T000000Z=parcial',
    '20261103T000000Z=parcial',
    '20261104T000000Z=parcial',
    'otra-cosa=parcial',
  ];

  assert.equal(cli(['rotate', '--keep', '2'], lines.join('\r\n')).out, '20261102T000000Z');
  assert.deepEqual(cli(['rotate', '--keep', '2'], ''), { code: 0, out: '', err: '' });
  assert.equal(cli(['rotate', '--keep', '0'], lines.join('\n')).code, 1);
});
