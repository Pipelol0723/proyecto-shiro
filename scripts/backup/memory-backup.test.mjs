// @ts-check
// Tests de la copia de seguridad de la memoria (P-11a). Se ejecutan con
// `npm run test:scripts`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  parseOllamaList,
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
    insert.run(
      `t${String(i)}`,
      `turno ${String(i)}`,
      `2026-11-2${String(i)}T10:00:00.000Z`,
      i === 0 ? 'x' : null,
    );
  }
  return db;
}

/** @param {string[]} args @param {string} [input] */
function cli(args, input) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input }).trim();
}

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

  const copy = join(work, 'abierta-copia.db');
  const info = await snapshotMemory(source, copy);
  db.close();

  assert.deepEqual(info, {
    userVersion: 1,
    turns: 3,
    pending: 2,
    firstTurnAt: '2026-11-20T10:00:00.000Z',
    lastTurnAt: '2026-11-22T10:00:00.000Z',
  });
  assert.equal(existsSync(`${copy}-wal`), false, 'la copia es un solo archivo');
});

test('una base que no es la memoria de Shiro no se da por copiada', async () => {
  const other = join(work, 'otra.db');
  new Database(other).exec('CREATE TABLE cosas (id INTEGER)').close();

  await assert.rejects(snapshotMemory(other, join(work, 'otra-copia.db')), /no parece la memoria/);
  await assert.rejects(snapshotMemory(join(work, 'no-existe.db'), join(work, 'x.db')), /no existe/);
});

test('la rotación conserva las más nuevas y no toca lo que no es una copia', () => {
  const copies = Array.from({ length: 9 }, (_, i) => `2026111${String(i)}T100000Z`);
  const names = [...copies, 'notas.txt', '20261101', 'claves', '20261120T100000Z.partial'];

  assert.deepEqual(planRotation(names, 7), ['20261111T100000Z', '20261110T100000Z']);
  assert.deepEqual(planRotation(copies.slice(0, 7), 7), []);
  assert.throws(() => planRotation(copies, 0), /al menos una/);
});

test('lee los modelos de «ollama list» y la imagen de Letta del compose', () => {
  const list =
    'NAME            ID              SIZE      MODIFIED\nqwen2.5:3b      357c53fb659c    1.9 GB    3 weeks ago\n\n';
  assert.deepEqual(parseOllamaList(list), [{ name: 'qwen2.5:3b', id: '357c53fb659c' }]);

  const compose = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(lettaImageFromCompose(compose) ?? '', /^letta\/letta@sha256:[0-9a-f]{64}$/);
});

test('crear, comprobar y anotar una copia sin el volcado de Letta', async () => {
  const out = join(work, 'copia-sin-letta');
  openMemory(join(work, 'origen.db'), 5).close();
  writeFileSync(join(work, 'ollama.txt'), 'NAME ID SIZE MODIFIED\nqwen2.5:3b abc123 1.9 GB hoy\n');

  const created = JSON.parse(
    cli([
      'create',
      '--db',
      join(work, 'origen.db'),
      '--out',
      out,
      '--name',
      '20261120T083005Z',
      '--no-letta',
      'Letta no estaba en marcha',
      '--ollama-list',
      join(work, 'ollama.txt'),
    ]),
  );
  assert.deepEqual(created, { name: '20261120T083005Z', turns: 5, complete: false });

  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.complete, false);
  assert.deepEqual(
    manifest.files.map((/** @type {{ name: string }} */ f) => f.name),
    ['memory.db'],
  );
  assert.deepEqual(manifest.letta.reason, 'Letta no estaba en marcha');
  assert.deepEqual(manifest.ollama, [{ name: 'qwen2.5:3b', id: 'abc123' }]);
  assert.equal(cli(['verify', '--dir', out]), 'ok');

  const marked = cli(['mark', '--db', join(work, 'origen.db'), '--dir', out]);
  const record = JSON.parse(readFileSync(marked, 'utf8'));
  assert.equal(marked, join(work, 'last-backup.json'));
  assert.deepEqual(
    { name: record.name, complete: record.complete, turns: record.turns },
    { name: '20261120T083005Z', complete: false, turns: 5 },
  );
  assert.ok(!Number.isNaN(Date.parse(record.at)));
});

test('con el volcado de Letta la copia es completa, y un archivo cambiado se detecta', async () => {
  const out = join(work, 'copia-completa');
  openMemory(join(work, 'origen2.db')).close();
  // El script de PowerShell deja el volcado en la carpeta antes de llamar.
  cli([
    'create',
    '--db',
    join(work, 'origen2.db'),
    '--out',
    out,
    '--name',
    '20261121T083005Z',
    '--no-letta',
    'x',
  ]);
  writeFileSync(join(out, 'letta.dump'), 'volcado de prueba');
  const created = JSON.parse(
    cli([
      'create',
      '--db',
      join(work, 'origen2.db'),
      '--out',
      out,
      '--name',
      '20261121T083005Z',
      '--letta-image',
      'letta/letta@sha256:abc',
    ]),
  );
  assert.equal(created.complete, true);
  assert.deepEqual(await verifyBackup(out), []);

  appendFileSync(join(out, 'letta.dump'), '!');
  assert.deepEqual(await verifyBackup(out), ['letta.dump no coincide']);
  rmSync(join(out, 'memory.db'));
  assert.deepEqual(await verifyBackup(out), ['falta memory.db', 'letta.dump no coincide']);
});

test('sin el volcado en la carpeta, una copia que dice llevar Letta falla', () => {
  openMemory(join(work, 'origen3.db')).close();
  assert.throws(
    () =>
      cli([
        'create',
        '--db',
        join(work, 'origen3.db'),
        '--out',
        join(work, 'sin-volcado'),
        '--name',
        'n',
      ]),
    /falta letta\.dump/,
  );
});

test('la rotación por la línea de comandos lee los nombres por la entrada', () => {
  const names = ['20261101T000000Z', '20261102T000000Z', '20261103T000000Z', 'otra-cosa'];
  assert.equal(cli(['rotate', '--keep', '2'], names.join('\r\n')), '20261101T000000Z');
});
