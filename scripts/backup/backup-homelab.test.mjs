// @ts-check
// Tests del script de copia (`scripts/backup-homelab.ps1`, P-11a) contra una
// carpeta local. Salvo el primero, solo corren en Windows: el script es de
// PowerShell. Se ejecutan con `npm run test:scripts`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { BACKUP_NAME, verifyBackup } from './memory-backup.mjs';

const SCRIPT = fileURLToPath(new URL('../backup-homelab.ps1', import.meta.url));
const skip = process.platform === 'win32' ? false : 'el script es de PowerShell para Windows';
const work = mkdtempSync(join(tmpdir(), 'shiro-backup-ps1-'));
after(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Una memoria con turnos en su propia carpeta, como la de la app. */
function makeMemory(/** @type {string} */ folder, turns = 1) {
  mkdirSync(join(work, folder), { recursive: true });
  const path = join(work, folder, 'memory.db');
  const db = new Database(path);
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT, role TEXT, text TEXT,
    timestamp TEXT, metadata TEXT, synced_at TEXT)`);
  const insert = db.prepare(
    `INSERT INTO messages VALUES (?, 'me', 'user', 'hola', '2026-11-20T10:00:00.000Z', NULL, NULL)`,
  );
  for (let i = 0; i < turns; i += 1) insert.run(`t${String(i)}`);
  db.close();
  return path;
}

/**
 * Ejecuta el script. Sin `env` se salta Letta; con él, usa el `docker` de pega.
 *
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function run(args, env) {
  const base = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];
  const result = spawnSync('powershell', [...base, ...(env ? [] : ['-SkipLetta']), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** La única copia que hay en una carpeta de destino, con su manifiesto. */
function onlyCopy(/** @type {string} */ destination) {
  const names = readdirSync(destination);
  assert.equal(names.length, 1, names.join(', '));
  const dir = join(destination, names[0] ?? '');
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) };
}

/**
 * Un `docker` de pega, delante en el PATH: contesta como el de verdad a lo
 * que el script le pide, y falla donde le digan las variables `STUB_*`.
 */
const stubDir = join(work, 'docker-de-pega');
mkdirSync(stubDir);
writeFileSync(join(stubDir, 'docker.cmd'), '@node "%~dp0docker.js" %*\r\n');
writeFileSync(
  join(stubDir, 'docker.js'),
  `const fs = require('node:fs');
const [command, ...args] = process.argv.slice(2);
const env = process.env;
if (command === 'ps') console.log((env.STUB_CONTAINERS ?? 'letta-1').split(',').join('\\n'));
if (command === 'inspect') console.log('letta/letta@sha256:de-pega');
if (command === 'cp') {
  if (env.STUB_CP_FAIL) process.exit(1);
  const memory = require('node:path').join(require('node:path').dirname(args[1]), 'memory.db');
  fs.writeFileSync(args[1], 'volcado de pega; memoria ya copiada: ' + fs.existsSync(memory));
}
if (command === 'exec') {
  const script = args.join(' ');
  if (script.includes('pg_dump') && env.STUB_DUMP_FAIL) process.exit(1);
  if (script.includes('psql')) console.log('agents=1\\nmessages=2');
}
`,
);
const withDocker = (/** @type {Record<string, string>} */ extra = {}) => ({
  PATH: `${stubDir};${process.env.PATH ?? ''}`,
  ...extra,
});

test('el script lleva la marca BOM: sin ella Windows PowerShell 5.1 estropea las tildes', () => {
  assert.deepEqual([...readFileSync(SCRIPT).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('sin la carpeta de destino no copia nada: crearla hay que pedirlo', { skip }, () => {
  const db = makeMemory('pedir');
  const destination = join(work, 'pedir-destino');

  const { code, output } = run(['-MemoryDb', db, '-Destination', destination]);

  assert.equal(code, 3, output);
  assert.equal(existsSync(destination), false);
  assert.equal(existsSync(join(work, 'pedir', 'last-backup.json')), false);
});

test('una copia a una carpeta: llega entera, se comprueba y se anota', { skip }, async () => {
  const db = makeMemory('entera');
  const destination = join(work, 'entera-destino');

  const { code, output } = run([
    '-MemoryDb',
    db,
    '-Destination',
    destination,
    '-CreateDestination',
  ]);

  assert.equal(code, 0, output);
  const [name, ...rest] = readdirSync(destination);
  assert.match(name ?? '', BACKUP_NAME);
  assert.deepEqual(rest, [], 'no queda ninguna carpeta a medias');
  assert.deepEqual(await verifyBackup(join(destination, name ?? '')), []);
  const manifest = JSON.parse(readFileSync(join(destination, name ?? '', 'manifest.json'), 'utf8'));
  assert.equal(manifest.memory.turns, 1);
  assert.equal(manifest.complete, false, 'sin el volcado de Letta la copia no es completa');
  const record = JSON.parse(readFileSync(join(work, 'entera', 'last-backup.json'), 'utf8'));
  assert.deepEqual({ name: record.name, complete: record.complete }, { name, complete: false });
});

test(
  'conserva las más nuevas y la última completa, y no toca lo que no es una copia',
  { skip },
  () => {
    const db = makeMemory('rotar');
    const destination = join(work, 'rotar-destino');
    /** Una carpeta del destino; con `complete` lleva un manifiesto de copia. */
    const folder = (/** @type {string} */ name, /** @type {boolean} */ complete) => {
      mkdirSync(join(destination, name), { recursive: true });
      if (complete === undefined) return;
      writeFileSync(join(destination, name, 'manifest.json'), JSON.stringify({ complete }));
    };
    folder('20250101T000000Z', true);
    folder('20250102T000000Z', false);
    folder('20250103T000000Z', false);
    folder('20250104T000000Z'); // con nombre de copia, pero sin manifiesto
    folder('otra-carpeta');
    writeFileSync(join(destination, 'notas.txt'), 'no es una copia');

    // La copia nueva va sin Letta: con dos por conservar, sobraría la completa.
    const { code, output } = run(['-MemoryDb', db, '-Destination', destination, '-Keep', '2']);

    assert.equal(code, 0, output);
    const left = readdirSync(destination).sort();
    assert.equal(left.length, 6, left.join(', '));
    assert.deepEqual(left.slice(0, 3), [
      '20250101T000000Z',
      '20250103T000000Z',
      '20250104T000000Z',
    ]);
    assert.match(left[3] ?? '', BACKUP_NAME);
    assert.deepEqual(left.slice(4), ['notas.txt', 'otra-carpeta']);
  },
);

test('una memoria sin turnos no se copia, salvo que se pida', { skip }, () => {
  const db = makeMemory('vacia', 0);
  const destination = join(work, 'vacia-destino');
  mkdirSync(destination);

  const refused = run(['-MemoryDb', db, '-Destination', destination]);
  assert.equal(refused.code, 1, refused.output);
  assert.deepEqual(readdirSync(destination), [], 'no queda nada a medias en el destino');
  assert.equal(existsSync(join(work, 'vacia', 'last-backup.json')), false);

  const allowed = run(['-MemoryDb', db, '-Destination', destination, '-AllowEmpty']);
  assert.equal(allowed.code, 0, allowed.output);
});

test('si el otro equipo no responde, sale con un código propio y no anota nada', { skip }, () => {
  const db = makeMemory('apagado');

  const { code, output } = run([
    ...['-MemoryDb', db, '-RemoteHost', '127.0.0.1', '-RemoteUser', 'nadie'],
    ...['-KeyFile', join(work, 'sin-clave'), '-RemotePort', '1'],
  ]);

  assert.equal(code, 2, output);
  assert.match(output, /no responde/);
  assert.equal(existsSync(join(work, 'apagado', 'last-backup.json')), false);
});

test('sin la base de la memoria es un error', { skip }, () => {
  const { code, output } = run(['-MemoryDb', join(work, 'no-existe.db'), '-Destination', work]);

  assert.equal(code, 1, output);
  assert.match(output, /no existe la base/);
});

// ── Lo que pidió la revisión del segundo agente ──

test('con Letta en marcha la copia es completa y lleva las filas por tabla', { skip }, async () => {
  const db = makeMemory('con-letta');
  const destination = join(work, 'con-letta-destino');
  mkdirSync(destination);

  const { code, output } = run(['-MemoryDb', db, '-Destination', destination], withDocker());

  assert.equal(code, 0, output);
  const { dir, manifest } = onlyCopy(destination);
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.letta, {
    included: true,
    image: 'letta/letta@sha256:de-pega',
    rows: { agents: 1, messages: 2 },
  });
  assert.deepEqual(await verifyBackup(dir), []);
  // La memoria se saca antes que el volcado: un turno que se envíe a Letta
  // entre los dos pasos queda en la copia como pendiente, y al restaurar se
  // reenvía. Al revés constaría como enviado sin estar en el volcado.
  assert.equal(
    readFileSync(join(dir, 'letta.dump'), 'utf8'),
    'volcado de pega; memoria ya copiada: true',
  );
});

test(
  'si el volcado de Letta falla, la memoria se copia igual y la copia queda parcial',
  { skip },
  () => {
    const db = makeMemory('letta-falla');
    const destination = join(work, 'letta-falla-destino');
    mkdirSync(destination);
    const args = ['-MemoryDb', db, '-Destination', destination];

    const strict = run([...args, '-RequireLetta'], withDocker({ STUB_CP_FAIL: '1' }));
    assert.equal(strict.code, 1, strict.output);
    assert.deepEqual(readdirSync(destination), [], 'con -RequireLetta no se copia nada');

    const { code, output } = run(args, withDocker({ STUB_CP_FAIL: '1' }));
    assert.equal(code, 0, output);
    const { dir, manifest } = onlyCopy(destination);
    assert.equal(manifest.complete, false);
    assert.match(manifest.letta.reason, /el volcado de Letta falló/);
    assert.deepEqual(readdirSync(dir).sort(), ['manifest.json', 'memory.db']);
  },
);

test('con dos contenedores de Letta no elige uno a ciegas', { skip }, () => {
  const db = makeMemory('dos-lettas');
  const destination = join(work, 'dos-lettas-destino');
  mkdirSync(destination);

  const { code, output } = run(
    ['-MemoryDb', db, '-Destination', destination],
    withDocker({ STUB_CONTAINERS: 'letta-a,letta-b' }),
  );

  assert.equal(code, 0, output);
  const { manifest } = onlyCopy(destination);
  assert.equal(manifest.complete, false);
  assert.match(manifest.letta.reason, /-LettaContainer/);
});

test(
  'la copia recién hecha no se retira aunque en el destino haya otras con fecha posterior',
  { skip },
  () => {
    const db = makeMemory('reloj');
    const destination = join(work, 'reloj-destino');
    for (const later of ['29990101T000000Z', '29990102T000000Z']) {
      mkdirSync(join(destination, later), { recursive: true });
      writeFileSync(join(destination, later, 'manifest.json'), JSON.stringify({ complete: true }));
    }

    const { code, output } = run(['-MemoryDb', db, '-Destination', destination, '-Keep', '2']);

    assert.equal(code, 0, output);
    const record = JSON.parse(readFileSync(join(work, 'reloj', 'last-backup.json'), 'utf8'));
    assert.ok(existsSync(join(destination, record.name)), 'la copia anotada sigue en el destino');
  },
);

test('una carpeta de destino con espacios y comillas simples', { skip }, async () => {
  const db = makeMemory('raro');
  const destination = join(work, "des tino's");

  const { code, output } = run([
    '-MemoryDb',
    db,
    '-Destination',
    destination,
    '-CreateDestination',
  ]);

  assert.equal(code, 0, output);
  assert.deepEqual(await verifyBackup(onlyCopy(destination).dir), []);
});

test('pedir que no se conserve ninguna copia falla antes de tocar nada', { skip }, () => {
  const db = makeMemory('keep-cero');
  const destination = join(work, 'keep-cero-destino');
  mkdirSync(join(destination, '20250101T000000Z'), { recursive: true });

  const { code, output } = run(['-MemoryDb', db, '-Destination', destination, '-Keep', '0']);

  assert.equal(code, 1, output);
  assert.deepEqual(readdirSync(destination), ['20250101T000000Z']);
  assert.equal(existsSync(join(work, 'keep-cero', 'last-backup.json')), false);
});

test('con -Installed copia la memoria de la app instalada', { skip }, () => {
  const tauri = JSON.parse(
    readFileSync(
      new URL('../../packages/desktop/src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    ),
  );
  const db = makeMemory(join('appdata', tauri.identifier, 'data'));
  const destination = join(work, 'instalada-destino');
  mkdirSync(destination);

  const result = spawnSync(
    'powershell',
    [
      ...['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-SkipLetta'],
      ...['-Installed', '-Destination', destination],
    ],
    { encoding: 'utf8', env: { ...process.env, LOCALAPPDATA: join(work, 'appdata') } },
  );

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(onlyCopy(destination).manifest.memory.turns, 1);
  assert.ok(existsSync(join(db, '..', 'last-backup.json')));
});

// El servidor busca la anotación al lado de su memoria; el script la escribe
// al lado de la que copia. En desarrollo tienen que ser el mismo archivo.
test('la memoria que el script copia por defecto es la del servidor de desarrollo', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  const config = readFileSync(new URL('../../config/modules.config.yaml', import.meta.url), 'utf8');
  const scriptDefault = /\$MemoryDb = Join-Path \$PSScriptRoot '([^']+)'/.exec(script)?.[1];
  const hostDefault = /db_path:\s*'([^']+)'/.exec(config)?.[1];

  // `npm run dev` arranca el servidor en packages/core-host.
  const fromScript = join('scripts', (scriptDefault ?? '').replaceAll('\\', '/'));
  const fromHost = join('packages', 'core-host', hostDefault ?? '');
  assert.ok(scriptDefault && hostDefault, 'se leen las dos rutas');
  assert.equal(fromScript, fromHost);
});

// Pasó en el CI de Windows: lanzado desde PowerShell 7, Windows PowerShell
// hereda su lista de módulos y deja de reconocer las funciones que trae en un
// módulo de script, como `Get-FileHash`. El hash se calcula con .NET. El job
// `verify-windows` ejecuta estos tests desde PowerShell 7, así que es la
// prueba de verdad; esto solo impide volver a la función.
test('el script no depende de funciones que se pierden al lanzarlo desde PowerShell 7', () => {
  assert.doesNotMatch(readFileSync(SCRIPT, 'utf8'), /Get-FileHash/);
});
