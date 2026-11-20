// @ts-check
// Tests de la restauración de verdad (`scripts/restore-backup.ps1`, P-11a).
// Salvo el primero, solo corren en Windows: el script es de PowerShell. Docker
// es de pega; la memoria se restaura en carpetas temporales.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { sha256File } from './memory-backup.mjs';

const SCRIPT = fileURLToPath(new URL('../restore-backup.ps1', import.meta.url));
const HELPER = fileURLToPath(new URL('./memory-backup.mjs', import.meta.url));
const skip = process.platform === 'win32' ? false : 'el script es de PowerShell para Windows';
const work = mkdtempSync(join(tmpdir(), 'shiro-restore-backup-'));
after(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Un `docker` de pega, delante en el PATH. Apunta lo que se le pide y falla
 * donde le digan las variables `STUB_*`.
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
if (command === 'ps') console.log((env.STUB_CONTAINERS ?? 'letta-1').split(',').join('\\n'));
if (command === 'inspect') console.log(env.STUB_IMAGE ?? 'letta/letta@sha256:de-pega');
if (command === 'restart' && env.STUB_RESTART_FAIL) process.exit(1);
if (command === 'exec') {
  const script = args.join(' ');
  if (script.includes('pg_restore') && env.STUB_RESTORE_FAIL) process.exit(1);
  if (script.includes('--single-transaction') && env.STUB_SWAP_FAIL) process.exit(1);
  if (script.includes('-At')) console.log((env.STUB_ROWS ?? 'agents=1,messages=2').split(',').join('\\n'));
}
`,
);

/** Una memoria con `turns` turnos. */
function makeMemory(/** @type {string} */ file, turns = 1) {
  const db = new Database(file);
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT, role TEXT, text TEXT,
    timestamp TEXT, metadata TEXT, synced_at TEXT)`);
  const insert = db.prepare(
    `INSERT INTO messages VALUES (?, 'me', 'user', 'hola', '2026-11-20T10:00:00.000Z', NULL, NULL)`,
  );
  for (let i = 0; i < turns; i += 1) insert.run(`t${String(i)}`);
  db.close();
}

/** Una copia de tres turnos hecha con el ayudante; con `letta`, lleva el volcado. */
function makeCopy(/** @type {string} */ name, letta = false) {
  makeMemory(join(work, `${name}.db`), 3);
  const dir = join(work, name);
  mkdirSync(dir);
  const args = ['create', '--db', join(work, `${name}.db`), '--out', dir];
  args.push('--name', '20261120T083005Z');
  if (letta) {
    writeFileSync(join(dir, 'letta.dump'), 'volcado de pega');
    writeFileSync(join(work, `${name}-filas.txt`), 'agents=1\nmessages=2\n');
    args.push('--letta-image', 'letta/letta@sha256:de-pega');
    args.push('--letta-rows', join(work, `${name}-filas.txt`));
  } else {
    args.push('--no-letta', 'Letta no estaba en marcha');
  }
  const created = spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  return dir;
}

/** Una carpeta de datos con una memoria anterior de siete turnos y sus dos archivos de al lado. */
function makeDataDir(/** @type {string} */ name) {
  const dir = join(work, name);
  mkdirSync(dir);
  makeMemory(join(dir, 'memory.db'), 7);
  writeFileSync(join(dir, 'memory.db-wal'), 'wal de la memoria anterior');
  writeFileSync(join(dir, 'memory.db-shm'), 'shm de la memoria anterior');
  return dir;
}

/**
 * Ejecuta la restauración con el `docker` de pega.
 *
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function run(args, env = {}) {
  rmSync(stubLog, { force: true });
  appendFileSync(stubLog, '');
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDir};${process.env.PATH ?? ''}`,
        STUB_LOG: stubLog,
        // Un puerto en el que no escucha nadie: Shiro «cerrado».
        SHIRO_HOST_PORT: '1',
        ...env,
      },
    },
  );
  const docker = readFileSync(stubLog, 'utf8').split('\n').filter(Boolean);
  return { code: result.status, output: `${result.stdout}${result.stderr}`, docker };
}

const turnsIn = (/** @type {string} */ file) => {
  const db = new Database(file, { readonly: true });
  try {
    return /** @type {{ n: number }} */ (db.prepare('SELECT COUNT(*) AS n FROM messages').get()).n;
  } finally {
    db.close();
  }
};

test('el script lleva la marca BOM y no usa funciones que se pierden desde PowerShell 7', () => {
  const bytes = readFileSync(SCRIPT);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.doesNotMatch(bytes.toString('utf8'), /Get-FileHash/);
});

test('sin decir qué restaurar, no hace nada', { skip }, () => {
  const { code, output } = run(['-Backup', makeCopy('sin-decir'), '-Yes']);

  assert.equal(code, 1, output);
  assert.match(output, /di qué restaurar/);
});

test('sin -Yes dice lo que haría y no cambia nada', { skip }, () => {
  const data = makeDataDir('ensayo-datos');
  const db = join(data, 'memory.db');

  const { code, output } = run(['-Backup', makeCopy('ensayo'), '-Memory', '-MemoryDb', db]);

  assert.equal(code, 0, output);
  assert.match(output, /No se ha cambiado nada/);
  assert.equal(turnsIn(db), 7);
  assert.deepEqual(readdirSync(data).sort(), ['memory.db', 'memory.db-shm', 'memory.db-wal']);
});

test(
  'la memoria: aparta la anterior con sus dos archivos de al lado y pone la de la copia',
  { skip },
  async () => {
    const copy = makeCopy('memoria');
    const data = makeDataDir('memoria-datos');
    const db = join(data, 'memory.db');

    const { code, output } = run(['-Backup', copy, '-Memory', '-MemoryDb', db, '-Yes']);

    assert.equal(code, 0, output);
    assert.equal(await sha256File(db), await sha256File(join(copy, 'memory.db')));
    // Ningún archivo de la memoria anterior queda al lado de la restaurada:
    // SQLite aplicaría ese `-wal` encima.
    const left = readdirSync(data).sort();
    assert.equal(left.length, 2, left.join(', '));
    assert.match(left[0] ?? '', /^antes-\d{8}T\d{6}Z$/);
    assert.equal(left[1], 'memory.db');
    assert.deepEqual(readdirSync(join(data, left[0] ?? '')).sort(), [
      'memory.db',
      'memory.db-shm',
      'memory.db-wal',
    ]);
    assert.equal(turnsIn(join(data, left[0] ?? '', 'memory.db')), 7);
    assert.equal(turnsIn(db), 3);
  },
);

test('la memoria, cuando no había ninguna: la pone y no crea carpetas de más', { skip }, () => {
  const data = join(work, 'nueva-datos', 'data');

  const { code, output } = run([
    ...['-Backup', makeCopy('nueva'), '-Memory', '-Yes'],
    ...['-MemoryDb', join(data, 'memory.db')],
  ]);

  assert.equal(code, 0, output);
  assert.deepEqual(readdirSync(data), ['memory.db']);
});

test('con Shiro en marcha no toca nada', { skip }, async () => {
  const data = makeDataDir('en-marcha-datos');
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());

  try {
    const { code, output } = run(
      ['-Backup', makeCopy('en-marcha'), '-Memory', '-MemoryDb', join(data, 'memory.db'), '-Yes'],
      { SHIRO_HOST_PORT: String(port) },
    );

    assert.equal(code, 1, output);
    assert.match(output, /Shiro está en marcha/);
    assert.equal(turnsIn(join(data, 'memory.db')), 7);
  } finally {
    server.close();
  }
});

test('Letta: restaura aparte, compara, cambia las bases, reinicia y limpia', { skip }, () => {
  const { code, output, docker } = run(['-Backup', makeCopy('letta', true), '-Letta', '-Yes']);

  assert.equal(code, 0, output);
  const all = docker.join('\n');
  const order = [
    'cp ',
    'pg_restore',
    '--single-transaction',
    'restart letta-1',
    'rm -f /tmp/shiro-restore.dump',
  ];
  const at = order.map((step) => all.indexOf(step));
  assert.ok(
    at.every((index, i) => index !== -1 && (i === 0 || index > (at[i - 1] ?? -1))),
    all,
  );
  assert.match(all, /-d letta_restaurada --no-owner/);
  assert.match(all, /-v new=letta_restaurada -v old=letta_antes_\d{8}t\d{6}z --single-transaction/);
  assert.match(output, /2 tablas, 3 filas: igual que en la copia/);
  assert.match(output, /La base anterior queda guardada como «letta_antes_/);
});

test('Letta: con otra imagen, con dos contenedores o sin el volcado, no empieza', { skip }, () => {
  const copy = makeCopy('letta-no', true);
  const touched = (/** @type {string[]} */ docker) =>
    docker.some((line) => /^(cp|exec|restart) /.test(line));

  const image = run(['-Backup', copy, '-Letta', '-Yes'], { STUB_IMAGE: 'letta/letta@sha256:otra' });
  assert.equal(image.code, 1, image.output);
  assert.match(image.output, /otra imagen/);
  assert.equal(touched(image.docker), false);

  const two = run(['-Backup', copy, '-Letta', '-Yes'], { STUB_CONTAINERS: 'letta-a,letta-b' });
  assert.equal(two.code, 1, two.output);
  assert.match(two.output, /-LettaContainer/);
  assert.equal(touched(two.docker), false);

  const partial = run(['-Backup', makeCopy('letta-parcial'), '-Letta', '-Yes']);
  assert.equal(partial.code, 1, partial.output);
  assert.match(partial.output, /no lleva el volcado de Letta/);
  assert.deepEqual(partial.docker, []);
});

test(
  'Letta: si el volcado no se restaura o las filas no cuadran, la base en uso no se cambia',
  { skip },
  () => {
    const copy = makeCopy('letta-mal', true);
    const swapped = (/** @type {string[]} */ docker) =>
      docker.join('\n').includes('--single-transaction');
    const dropped = (/** @type {string[]} */ docker) =>
      docker.some((line) => line.endsWith('dropdb --if-exists -U $POSTGRES_USER letta_restaurada'));

    const failed = run(['-Backup', copy, '-Letta', '-Yes'], { STUB_RESTORE_FAIL: '1' });
    assert.equal(failed.code, 1, failed.output);
    assert.match(failed.output, /no se ha tocado/);
    assert.equal(swapped(failed.docker), false);
    assert.ok(dropped(failed.docker), 'lo restaurado a medias se retira');

    const different = run(['-Backup', copy, '-Letta', '-Yes'], {
      STUB_ROWS: 'agents=1,messages=9',
    });
    assert.equal(different.code, 1, different.output);
    assert.equal(swapped(different.docker), false);
    assert.ok(dropped(different.docker));
  },
);

test(
  'Letta: si el cambio de bases no entra, no reinicia y dice dónde queda lo restaurado',
  { skip },
  () => {
    const { code, output, docker } = run(
      ['-Backup', makeCopy('letta-cambio', true), '-Letta', '-Yes'],
      {
        STUB_SWAP_FAIL: '1',
      },
    );

    assert.equal(code, 1, output);
    assert.match(output, /letta_restaurada/);
    assert.equal(docker.filter((line) => line.includes('--single-transaction')).length, 3);
    assert.equal(
      docker.some((line) => line.startsWith('restart')),
      false,
    );
  },
);

test('las dos cosas: primero Letta y después la memoria, de la misma copia', { skip }, () => {
  const data = makeDataDir('dos-datos');
  const db = join(data, 'memory.db');

  const { code, output } = run([
    ...['-Backup', makeCopy('dos', true), '-Memory', '-Letta', '-Yes'],
    ...['-MemoryDb', db],
  ]);

  assert.equal(code, 0, output);
  assert.ok(output.indexOf('Letta restaurado.') < output.indexOf('memoria restaurada.'), output);
  assert.match(output, /de la misma copia/);
  assert.equal(turnsIn(db), 3);
});

test('si Letta falla, la memoria no se toca', { skip }, () => {
  const data = makeDataDir('letta-falla-datos');
  const db = join(data, 'memory.db');

  const { code, output } = run(
    ['-Backup', makeCopy('letta-falla', true), '-Memory', '-Letta', '-Yes', '-MemoryDb', db],
    { STUB_RESTORE_FAIL: '1' },
  );

  assert.equal(code, 1, output);
  assert.equal(turnsIn(db), 7);
  assert.equal(existsSync(join(data, 'memory.db-wal')), true);
});

// ── Volver a la base anterior de Letta ──

test(
  'volver atrás en Letta: cambia la base en uso por la guardada, sin borrar ninguna',
  { skip },
  () => {
    const saved = 'letta_antes_20261120t083005z';

    const asked = run(['-LettaUndo', saved]);
    assert.equal(asked.code, 0, asked.output);
    assert.match(asked.output, /No se ha cambiado nada/);
    assert.equal(
      asked.docker.some((line) => /^(exec|restart) /.test(line)),
      false,
    );

    const { code, output, docker } = run(['-LettaUndo', saved, '-Yes']);
    assert.equal(code, 0, output);
    const all = docker.join('\n');
    assert.match(
      all,
      new RegExp(`-v new=${saved} -v old=letta_descartada_\\d{8}t\\d{6}z --single-transaction`),
    );
    assert.ok(all.indexOf('--single-transaction') < all.indexOf('restart letta-1'), all);
    assert.doesNotMatch(all, /dropdb/);
    assert.match(output, /queda guardada como «letta_descartada_/);
  },
);

test(
  'volver atrás solo acepta el nombre de una base guardada por la restauración',
  { skip },
  () => {
    const { code, output, docker } = run(['-LettaUndo', 'postgres', '-Yes']);

    assert.equal(code, 1, output);
    assert.match(output, /letta_antes_/);
    assert.deepEqual(docker, []);
  },
);

test('sin copia y sin vuelta atrás, no hay nada que hacer', { skip }, () => {
  const { code, output } = run(['-Memory', '-Yes']);

  assert.equal(code, 1, output);
  assert.match(output, /-Backup/);
});

test(
  'si Letta no se reinicia tras el cambio, dice que la base ya está cambiada y cómo seguir',
  { skip },
  () => {
    const data = makeDataDir('reinicio-datos');
    const db = join(data, 'memory.db');

    const { code, output, docker } = run(
      ['-Backup', makeCopy('reinicio', true), '-Memory', '-Letta', '-Yes', '-MemoryDb', db],
      { STUB_RESTART_FAIL: '1' },
    );

    assert.equal(code, 1, output);
    assert.match(output, /la base de Letta ya está cambiada/);
    assert.match(output, /docker restart letta-1/);
    assert.match(output, /-Memory/);
    // Lo restaurado no se retira después del cambio: ya es la base en uso.
    const afterSwap = docker.slice(
      docker.findIndex((line) => line.includes('--single-transaction')),
    );
    assert.equal(
      afterSwap.some((line) => line.includes('dropdb')),
      false,
      afterSwap.join(' | '),
    );
    assert.equal(turnsIn(db), 7);
  },
);
