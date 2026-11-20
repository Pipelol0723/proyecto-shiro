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
function makeMemory(/** @type {string} */ folder) {
  mkdirSync(join(work, folder), { recursive: true });
  const path = join(work, folder, 'memory.db');
  const db = new Database(path);
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, user_id TEXT, role TEXT, text TEXT,
    timestamp TEXT, metadata TEXT, synced_at TEXT)`);
  db.prepare(
    `INSERT INTO messages VALUES ('a', 'me', 'user', 'hola', '2026-11-20T10:00:00.000Z', NULL, NULL)`,
  ).run();
  db.close();
  return path;
}

/** @param {string[]} args */
function run(args) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-SkipLetta', ...args],
    { encoding: 'utf8' },
  );
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

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

test('conserva las copias más nuevas y no toca lo demás que haya en la carpeta', { skip }, () => {
  const db = makeMemory('rotar');
  const destination = join(work, 'rotar-destino');
  for (const old of ['20250101T000000Z', '20250102T000000Z', '20250103T000000Z', 'otra-carpeta']) {
    mkdirSync(join(destination, old), { recursive: true });
  }
  writeFileSync(join(destination, 'notas.txt'), 'no es una copia');

  const { code, output } = run(['-MemoryDb', db, '-Destination', destination, '-Keep', '2']);

  assert.equal(code, 0, output);
  const left = readdirSync(destination).sort();
  assert.equal(left.length, 4, left.join(', '));
  assert.deepEqual(left.slice(0, 1), ['20250103T000000Z']);
  assert.match(left[1] ?? '', BACKUP_NAME);
  assert.deepEqual(left.slice(2), ['notas.txt', 'otra-carpeta']);
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
