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
 * Un `docker` de pega, delante en el PATH. Apunta lo que se le pide, falla
 * donde le digan las variables `STUB_*` y recuerda si el cambio de bases ya se
 * hizo, para contestar a «¿existe esta base?» como lo haría Postgres:
 *
 * - Al restaurar: antes del cambio existe `letta_restaurada`; después, la
 *   guardada (`letta_antes_…`).
 * - Al volver atrás (`STUB_MODE=undo`): antes existe la guardada
 *   (`letta_antes_…`); después, `letta_descartada_…`.
 */
const stubDir = join(work, 'docker-de-pega');
const stubLog = join(work, 'docker.log');
const swapFlag = join(stubDir, 'cambiado');
mkdirSync(stubDir);
writeFileSync(join(stubDir, 'docker.cmd'), '@node "%~dp0docker.js" %*\r\n');
writeFileSync(
  join(stubDir, 'docker.js'),
  `const fs = require('node:fs');
const path = require('node:path');
const [command, ...args] = process.argv.slice(2);
const env = process.env;
const flag = path.join(__dirname, 'cambiado');
fs.appendFileSync(env.STUB_LOG, command + ' ' + args.join(' ') + '\\n');
if (command === 'ps') console.log((env.STUB_CONTAINERS ?? 'letta-1').split(',').join('\\n'));
if (command === 'inspect') console.log(env.STUB_IMAGE ?? 'letta/letta@sha256:de-pega');
if (command === 'restart' && env.STUB_RESTART_FAIL) process.exit(1);
if (command === 'exec') {
  const script = args.join(' ');
  const swapped = fs.existsSync(flag);
  const name = /-v name=(\\S+)/.exec(script)?.[1];
  if (script.includes('pg_isready')) {
    if (env.STUB_NOT_READY) process.exit(1);
  } else if (script.includes('pg_restore')) {
    if (env.STUB_RESTORE_FAIL) process.exit(1);
  } else if (name !== undefined) {
    let exists = swapped;
    if (name === 'letta_restaurada') exists = !swapped;
    if (env.STUB_MODE === 'undo' && name.startsWith('letta_antes_')) exists = !swapped;
    if (env.STUB_DB_MISSING === name) exists = false;
    console.log(exists ? 1 : 0);
  } else if (script.includes('--single-transaction')) {
    if (env.STUB_SWAP_FAIL) process.exit(1);
    if (!env.STUB_SWAP_NOOP) fs.writeFileSync(flag, '');
  } else if (script.includes('-At')) {
    console.log((env.STUB_ROWS ?? 'agents=1,messages=2').split(',').join('\\n'));
  }
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

/**
 * Una copia de tres turnos hecha con el ayudante. `letta` dice qué lleva de
 * Letta: nada, el volcado con sus filas (`'filas'`) o sin el recuento (`'sin-recuento'`).
 *
 * @param {string} name
 * @param {'filas' | 'sin-recuento'} [letta]
 */
function makeCopy(name, letta) {
  makeMemory(join(work, `${name}.db`), 3);
  const dir = join(work, name);
  mkdirSync(dir);
  const args = ['create', '--db', join(work, `${name}.db`), '--out', dir];
  args.push('--name', '20261120T083005Z');
  if (letta === undefined) {
    args.push('--no-letta', 'Letta no estaba en marcha');
  } else {
    writeFileSync(join(dir, 'letta.dump'), 'volcado de pega');
    args.push('--letta-image', 'letta/letta@sha256:de-pega');
    if (letta === 'filas') {
      writeFileSync(join(work, `${name}-filas.txt`), 'agents=1\nmessages=2\n');
      args.push('--letta-rows', join(work, `${name}-filas.txt`));
    }
  }
  const created = spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  return dir;
}

/**
 * Una carpeta de datos con una memoria anterior de siete turnos y sus dos
 * archivos de al lado. `leaf` es el nombre del archivo de la memoria.
 */
function makeDataDir(/** @type {string} */ name, leaf = 'memory.db') {
  const dir = join(work, name);
  mkdirSync(dir);
  makeMemory(join(dir, leaf), 7);
  writeFileSync(join(dir, `${leaf}-wal`), 'wal de la memoria anterior');
  writeFileSync(join(dir, `${leaf}-shm`), 'shm de la memoria anterior');
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
  rmSync(swapFlag, { force: true });
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

/** ¿Se pidió el cambio de bases? */
const swapAsked = (/** @type {string[]} */ docker) =>
  docker.some((line) => line.includes('--single-transaction'));

test('el script lleva la marca BOM y no usa funciones que se pierden desde PowerShell 7', () => {
  const bytes = readFileSync(SCRIPT);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.doesNotMatch(bytes.toString('utf8'), /Get-FileHash/);
});

test('sin copia, o sin decir qué restaurar, no hace nada', { skip }, () => {
  const nothing = run(['-Backup', makeCopy('sin-decir'), '-Yes']);
  assert.equal(nothing.code, 1, nothing.output);
  assert.match(nothing.output, /di qué restaurar/);

  const noBackup = run(['-Memory', '-Yes']);
  assert.equal(noBackup.code, 1, noBackup.output);
  assert.match(noBackup.output, /-Backup/);
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

test(
  'la memoria con otro nombre de archivo también se aparta antes de ponerle la copia encima',
  { skip },
  () => {
    const data = makeDataDir('otro-nombre-datos', 'otra.db');
    const db = join(data, 'otra.db');

    const { code, output } = run([
      '-Backup',
      makeCopy('otro-nombre'),
      '-Memory',
      '-MemoryDb',
      db,
      '-Yes',
    ]);

    assert.equal(code, 0, output);
    assert.equal(turnsIn(db), 3);
    const aside = readdirSync(data).find((name) => name.startsWith('antes-')) ?? '';
    assert.deepEqual(readdirSync(join(data, aside)).sort(), [
      'otra.db',
      'otra.db-shm',
      'otra.db-wal',
    ]);
    assert.equal(turnsIn(join(data, aside, 'otra.db')), 7);
    assert.deepEqual(readdirSync(data).sort(), [aside, 'otra.db']);
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
  const { code, output, docker } = run(['-Backup', makeCopy('letta', 'filas'), '-Letta', '-Yes']);

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
  const copy = makeCopy('letta-no', 'filas');
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
    const copy = makeCopy('letta-mal', 'filas');
    const dropped = (/** @type {string[]} */ docker) =>
      docker.some((line) => line.endsWith('dropdb --if-exists -U $POSTGRES_USER letta_restaurada'));

    const failed = run(['-Backup', copy, '-Letta', '-Yes'], { STUB_RESTORE_FAIL: '1' });
    assert.equal(failed.code, 1, failed.output);
    assert.match(failed.output, /no se ha tocado/);
    assert.equal(swapAsked(failed.docker), false);
    assert.ok(dropped(failed.docker), 'lo restaurado a medias se retira');

    const different = run(['-Backup', copy, '-Letta', '-Yes'], {
      STUB_ROWS: 'agents=1,messages=9',
    });
    assert.equal(different.code, 1, different.output);
    assert.equal(swapAsked(different.docker), false);
    assert.ok(dropped(different.docker));
  },
);

test(
  'Letta: una copia sin recuento se restaura, pero no si la base restaurada sale sin tablas',
  { skip },
  () => {
    const copy = makeCopy('letta-sin-recuento', 'sin-recuento');

    const fine = run(['-Backup', copy, '-Letta', '-Yes']);
    assert.equal(fine.code, 0, fine.output);
    assert.match(fine.output, /no lleva el recuento/);

    const empty = run(['-Backup', copy, '-Letta', '-Yes'], { STUB_ROWS: '' });
    assert.equal(empty.code, 1, empty.output);
    assert.match(empty.output, /sin tablas/);
    assert.equal(swapAsked(empty.docker), false);
  },
);

test(
  'Letta: si el cambio de bases no entra, no reinicia y dice dónde queda lo restaurado',
  { skip },
  () => {
    const copy = makeCopy('letta-cambio', 'filas');
    const restarted = (/** @type {string[]} */ docker) =>
      docker.some((line) => line.startsWith('restart'));

    const failed = run(['-Backup', copy, '-Letta', '-Yes'], { STUB_SWAP_FAIL: '1' });
    assert.equal(failed.code, 1, failed.output);
    assert.match(failed.output, /letta_restaurada/);
    assert.equal(failed.docker.filter((line) => line.includes('--single-transaction')).length, 3);
    assert.equal(restarted(failed.docker), false);

    // psql dice que fue bien, pero las bases siguen como estaban: no se da por hecho.
    const noop = run(['-Backup', copy, '-Letta', '-Yes'], { STUB_SWAP_NOOP: '1' });
    assert.equal(noop.code, 1, noop.output);
    assert.equal(restarted(noop.docker), false);
    assert.doesNotMatch(noop.output, /Letta restaurado\./);
  },
);

test(
  'si Letta no se reinicia tras el cambio, dice que la base ya está cambiada y cómo seguir',
  { skip },
  () => {
    const data = makeDataDir('reinicio-datos');
    const db = join(data, 'memory.db');

    const { code, output, docker } = run(
      ['-Backup', makeCopy('reinicio', 'filas'), '-Memory', '-Letta', '-Yes', '-MemoryDb', db],
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

test(
  'si Letta no responde tras reiniciar, sigue con la memoria pero no lo da por bueno',
  { skip },
  () => {
    const data = makeDataDir('no-responde-datos');
    const db = join(data, 'memory.db');

    const { code, output } = run(
      [
        ...['-Backup', makeCopy('no-responde', 'filas'), '-Memory', '-Letta', '-Yes'],
        ...['-MemoryDb', db, '-StartTimeoutSeconds', '1'],
      ],
      { STUB_NOT_READY: '1' },
    );

    assert.equal(code, 1, output);
    assert.match(output, /AVISO: Letta no responde/);
    assert.equal(turnsIn(db), 3);
  },
);

test('las dos cosas: primero Letta y después la memoria, de la misma copia', { skip }, () => {
  const data = makeDataDir('dos-datos');
  const db = join(data, 'memory.db');

  const { code, output } = run([
    ...['-Backup', makeCopy('dos', 'filas'), '-Memory', '-Letta', '-Yes'],
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
    ['-Backup', makeCopy('letta-falla', 'filas'), '-Memory', '-Letta', '-Yes', '-MemoryDb', db],
    { STUB_RESTORE_FAIL: '1' },
  );

  assert.equal(code, 1, output);
  assert.equal(turnsIn(db), 7);
  assert.equal(existsSync(join(data, 'memory.db-wal')), true);
});

test('si Letta entra y la memoria no, dice cómo quedó cada cosa y cómo volver', { skip }, () => {
  // La carpeta de datos es en realidad un archivo: la memoria no se puede poner.
  const blocker = join(work, 'no-es-carpeta');
  writeFileSync(blocker, 'x');

  const { code, output } = run([
    ...['-Backup', makeCopy('mixto', 'filas'), '-Memory', '-Letta', '-Yes'],
    ...['-MemoryDb', join(blocker, 'memory.db')],
  ]);

  assert.equal(code, 1, output);
  assert.match(output, /Letta ya es el de la copia/);
  assert.match(output, /-LettaUndo letta_antes_\d{8}t\d{6}z/);
});

// ── Volver a la base anterior de Letta ──

test(
  'volver atrás en Letta: cambia la base en uso por la guardada, sin borrar ninguna',
  { skip },
  () => {
    const saved = 'letta_antes_20261120t083005z';
    const undo = { STUB_MODE: 'undo' };

    const asked = run(['-LettaUndo', saved], undo);
    assert.equal(asked.code, 0, asked.output);
    assert.match(asked.output, /No se ha cambiado nada/);
    assert.equal(swapAsked(asked.docker), false);

    const { code, output, docker } = run(['-LettaUndo', saved, '-Yes'], undo);
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
  'volver atrás: solo con el nombre de una base guardada que exista, y sin mezclar',
  { skip },
  () => {
    const saved = 'letta_antes_20261120t083005z';
    const undo = { STUB_MODE: 'undo' };

    const other = run(['-LettaUndo', 'postgres', '-Yes'], undo);
    assert.equal(other.code, 1, other.output);
    assert.match(other.output, /letta_antes_/);
    assert.deepEqual(other.docker, []);

    const upper = run(['-LettaUndo', saved.toUpperCase(), '-Yes'], undo);
    assert.equal(upper.code, 1, upper.output);
    assert.deepEqual(upper.docker, []);

    // También sin -Yes: preguntar por una base que no existe no dice «se haría».
    const missing = run(['-LettaUndo', saved], { ...undo, STUB_DB_MISSING: saved });
    assert.equal(missing.code, 1, missing.output);
    assert.match(missing.output, /no existe/);
    assert.equal(swapAsked(missing.docker), false);

    const mixed = run(['-LettaUndo', saved, '-Memory', '-Yes'], undo);
    assert.equal(mixed.code, 1, mixed.output);
    assert.match(mixed.output, /solo/);
    assert.deepEqual(mixed.docker, []);
  },
);
