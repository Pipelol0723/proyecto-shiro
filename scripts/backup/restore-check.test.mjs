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
 * pide, contesta a los recuentos con `STUB_ROWS`, y falla al arrancar el
 * contenedor o al restaurar si se le dice (`STUB_RUN_FAIL`, `STUB_RESTORE_FAIL`).
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
if (command === 'run') {
  if (env.STUB_RUN_FAIL) process.exit(125);
  console.log('0123456789ab');
}
if (command === 'exec') {
  const script = args.join(' ');
  if (script.includes('pg_restore') && env.STUB_RESTORE_FAIL) process.exit(1);
  if (script.includes('psql')) console.log((env.STUB_ROWS ?? 'agents=1,messages=2').split(',').join('\\n'));
}
`,
);

/**
 * Una copia hecha con el ayudante. `letta` dice qué lleva de Letta: nada, el
 * volcado sin el recuento de filas (`''`), o el volcado con sus filas.
 *
 * @param {string} name
 * @param {string} [letta]
 */
function makeCopy(name, letta) {
  const db = new Database(join(work, `${name}.db`));
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT, role TEXT, text TEXT,
    timestamp TEXT, metadata TEXT, synced_at TEXT)`);
  db.exec(
    `INSERT INTO messages VALUES ('a', 'me', 'user', 'hola', '2026-11-20T10:00:00.000Z', NULL, NULL)`,
  );
  db.close();
  const dir = join(work, name);
  mkdirSync(dir);
  const args = ['create', '--db', join(work, `${name}.db`), '--out', dir];
  args.push('--name', '20261120T083005Z');
  if (letta === undefined) {
    args.push('--no-letta', 'Letta no estaba en marcha');
  } else {
    writeFileSync(join(dir, 'letta.dump'), 'volcado de pega');
    args.push('--letta-image', 'letta/letta@sha256:de-pega');
    if (letta !== '') {
      writeFileSync(join(work, `${name}-filas.txt`), letta.split(',').join('\n'));
      args.push('--letta-rows', join(work, `${name}-filas.txt`));
    }
  }
  const created = spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  return dir;
}

/**
 * Ejecuta el ensayo con el `docker` de pega y devuelve lo que se le pidió a Docker.
 *
 * @param {string} dir
 * @param {Record<string, string>} [env]
 * @param {string[]} [extra] más argumentos para el script
 */
function run(dir, env = {}, extra = []) {
  rmSync(stubLog, { force: true });
  appendFileSync(stubLog, '');
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Backup', dir, ...extra],
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

const CONTAINER = 'shiro-restore-check-\\d+-[0-9a-f]{8}';

/** ¿Se borró el contenedor temporal, con su volumen? */
const removed = (/** @type {string[]} */ docker) =>
  docker.some((line) => new RegExp(`^rm -f -v ${CONTAINER}$`).test(line));

test('el script lleva la marca BOM: sin ella Windows PowerShell 5.1 estropea las tildes', () => {
  assert.deepEqual([...readFileSync(SCRIPT).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test(
  'una copia sin Letta: se comprueba la memoria, que es lo que lleva, y no se arranca nada',
  { skip },
  () => {
    const { code, output, docker } = run(makeCopy('sin-letta'));

    assert.equal(code, 0, output);
    assert.match(output, /1 turnos/);
    assert.match(output, /la copia no lleva el volcado de Letta/);
    assert.match(output, /todo lo que lleva la copia se restaura bien/);
    assert.deepEqual(docker, []);
  },
);

test('una copia completa: restaura en un Letta temporal, compara y lo borra', { skip }, () => {
  const dir = makeCopy('completa', 'agents=1,messages=2');

  const { code, output, docker } = run(dir);

  assert.equal(code, 0, output);
  assert.match(output, /2 tablas, 3 filas: igual que en la copia/);
  assert.match(output, /todo lo que lleva la copia se restaura bien/);
  assert.match(
    docker[0] ?? '',
    new RegExp(`^run -d --name ${CONTAINER} letta/letta@sha256:de-pega$`),
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

// ── Lo que pidió la revisión del segundo agente ──

test('si Docker crea el contenedor y falla al arrancarlo, también se borra', { skip }, () => {
  const dir = makeCopy('no-arranca', 'agents=1,messages=2');

  const { code, output, docker } = run(dir, { STUB_RUN_FAIL: '1' });

  assert.equal(code, 1, output);
  assert.match(output, /no se pudo arrancar el Letta temporal/);
  assert.ok(removed(docker), docker.join(' | '));
});

test('con -SkipLetta en una copia completa no dice que todo se restaura bien', { skip }, () => {
  const dir = makeCopy('saltar-letta', 'agents=1,messages=2');

  const { code, output, docker } = run(dir, {}, ['-SkipLetta']);

  assert.equal(code, 2, output);
  assert.match(output, /el volcado de Letta no se ha ensayado/);
  assert.doesNotMatch(output, /todo lo que lleva la copia se restaura bien/);
  assert.deepEqual(docker, []);
});

test(
  'una copia sin el recuento de filas: restaura, pero no dice que está comparada',
  { skip },
  () => {
    const dir = makeCopy('sin-recuento', '');

    const { code, output, docker } = run(dir);

    assert.equal(code, 2, output);
    assert.match(output, /no lleva el recuento de filas/);
    assert.doesNotMatch(output, /todo lo que lleva la copia se restaura bien/);
    assert.ok(removed(docker));
  },
);
