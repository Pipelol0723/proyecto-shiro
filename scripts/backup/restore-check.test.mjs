// @ts-check
// Tests del ensayo de restauración (`scripts/restore-check.ps1`, P-11a). Salvo
// el primero, solo corren en Windows: el script es de PowerShell. Docker es de
// pega: el ensayo de verdad, con un Letta temporal, está descrito en RESTORE.md.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCRIPT = fileURLToPath(new URL('../restore-check.ps1', import.meta.url));
const HELPER = fileURLToPath(new URL('./memory-backup.mjs', import.meta.url));
const skip = process.platform === 'win32' ? false : 'el script es de PowerShell para Windows';
const work = mkdtempSync(join(tmpdir(), 'shiro-restore-check-'));
after(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Un `docker` de pega, delante en el PATH. Apunta en un archivo lo que se le
 * pide, contesta a los recuentos con `STUB_ROWS` y falla al restaurar si se
 * le dice `STUB_RESTORE_FAIL`.
 */
const stubDir = join(work, 'docker-de-pega');
const stubLog = join(work, 'docker.log');
mkdirSync(stubDir);
writeFileSync(join(stubDir, 'docker.cmd'), '@node "%~dp0docker.js" %*\r\n');
writeFileSync(
  join(stubDir, 'docker.js'),
  `const fs = require('node:fs');
const [command, ...args] = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.STUB_LOG, command + ' ' + args.join(' ') + '\\n');
if (command === 'run') console.log('0123456789ab');
if (command === 'exec') {
  const script = args.join(' ');
  if (script.includes('pg_restore') && env.STUB_RESTORE_FAIL) process.exit(1);
  if (script.includes('psql')) console.log((env.STUB_ROWS ?? 'agents=1,messages=2').split(',').join('\\n'));
}
`,
);

/** Una copia hecha con el ayudante; con `rows`, lleva el volcado de Letta. */
function makeCopy(/** @type {string} */ name, /** @type {string} */ rows = '') {
  const db = new Database(join(work, `${name}.db`));
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT, role TEXT, text TEXT,
    timestamp TEXT, metadata TEXT, synced_at TEXT)`);
  db.exec(
    `INSERT INTO messages VALUES ('a', 'me', 'user', 'hola', '2026-11-20T10:00:00.000Z', NULL, NULL)`,
  );
  db.close();
  const dir = join(work, name);
  mkdirSync(dir);
  const args = [
    'create',
    '--db',
    join(work, `${name}.db`),
    '--out',
    dir,
    '--name',
    '20261120T083005Z',
  ];
  if (rows === '') {
    args.push('--no-letta', 'Letta no estaba en marcha');
  } else {
    writeFileSync(join(dir, 'letta.dump'), 'volcado de pega');
    writeFileSync(join(work, `${name}-filas.txt`), rows.split(',').join('\n'));
    args.push(
      '--letta-image',
      'letta/letta@sha256:de-pega',
      '--letta-rows',
      join(work, `${name}-filas.txt`),
    );
  }
  const created = spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  return dir;
}

/** Ejecuta el ensayo con el `docker` de pega y devuelve lo que se le pidió a Docker. */
function run(/** @type {string} */ dir, /** @type {Record<string, string>} */ env = {}) {
  rmSync(stubLog, { force: true });
  appendFileSync(stubLog, '');
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Backup', dir],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDir};${process.env.PATH ?? ''}`,
        STUB_LOG: stubLog,
        ...env,
      },
    },
  );
  const docker = readFileSync(stubLog, 'utf8').split('\n').filter(Boolean);
  return { code: result.status, output: `${result.stdout}${result.stderr}`, docker };
}

/** ¿Se borró el contenedor temporal, con su volumen? */
const removed = (/** @type {string[]} */ docker) =>
  docker.some((line) => /^rm -f -v shiro-restore-check-\d+$/.test(line));

test('el script lleva la marca BOM: sin ella Windows PowerShell 5.1 estropea las tildes', () => {
  assert.deepEqual([...readFileSync(SCRIPT).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('una copia sin Letta: se comprueba la memoria y no se arranca nada', { skip }, () => {
  const { code, output, docker } = run(makeCopy('sin-letta'));

  assert.equal(code, 0, output);
  assert.match(output, /1 turnos/);
  assert.match(output, /solo se ha comprobado la memoria/);
  assert.deepEqual(docker, []);
});

test('una copia completa: restaura en un Letta temporal, compara y lo borra', { skip }, () => {
  const dir = makeCopy('completa', 'agents=1,messages=2');

  const { code, output, docker } = run(dir);

  assert.equal(code, 0, output);
  assert.match(output, /2 tablas, 3 filas: igual que en la copia/);
  assert.match(
    docker[0] ?? '',
    /^run -d --name shiro-restore-check-\d+ letta\/letta@sha256:de-pega$/,
  );
  assert.ok(removed(docker), docker.join(' | '));
  assert.equal(existsSync(join(dir, 'letta.dump')), true);
});

test('si al restaurar salen otras filas, el ensayo falla y lo dice', { skip }, () => {
  const dir = makeCopy('distinta', 'agents=1,messages=2');

  const { code, output, docker } = run(dir, { STUB_ROWS: 'agents=1,messages=1' });

  assert.equal(code, 1, output);
  assert.match(output, /messages: 2 en la copia y 1 al restaurar/);
  assert.ok(removed(docker), 'el contenedor temporal se borra también cuando falla');
});

test('si el volcado no se restaura, el ensayo falla y borra el contenedor', { skip }, () => {
  const dir = makeCopy('no-restaura', 'agents=1,messages=2');

  const { code, output, docker } = run(dir, { STUB_RESTORE_FAIL: '1' });

  assert.equal(code, 1, output);
  assert.match(output, /el volcado no se restaura/);
  assert.ok(removed(docker));
});

test('una memoria cambiada después de copiar se detecta antes de arrancar nada', { skip }, () => {
  const dir = makeCopy('cambiada', 'agents=1,messages=2');
  appendFileSync(join(dir, 'memory.db'), 'x');

  const { code, output, docker } = run(dir);

  assert.equal(code, 1, output);
  assert.match(output, /memory\.db no coincide/);
  assert.deepEqual(docker, []);
});
