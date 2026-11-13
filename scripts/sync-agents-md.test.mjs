// @ts-check
// Tests del generador de AGENTS.md. Se ejecutan con `npm run test:scripts`
// (node --test), no con Vitest: el script es una herramienta de Node suelta.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildAgentsMd } from './sync-agents-md.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'sync-agents-md.mjs');
const START = '<!-- agents-md:start -->';
const END = '<!-- agents-md:end -->';

const SAMPLE = [
  '# Instrucciones para Claude',
  '',
  '## Fuera uno',
  '',
  'No debe aparecer.',
  '',
  START,
  '',
  '## Regla uno',
  '',
  'Texto de la regla uno.',
  '',
  END,
  '',
  '## Fuera dos',
  '',
  'Tampoco.',
  '',
  START,
  '',
  '## Regla dos',
  '',
  'Texto de la regla dos.',
  '',
  END,
  '',
].join('\n');

/**
 * Ejecuta la CLI con rutas explícitas dentro de un directorio temporal.
 * @param {string} claude contenido de CLAUDE.md de prueba
 * @param {string | null} agents contenido de AGENTS.md de prueba (null: no existe)
 * @param {string[]} extra argumentos adicionales (p. ej. `--check`)
 */
function runCli(claude, agents, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-md-'));
  try {
    const claudePath = join(dir, 'CLAUDE.md');
    const agentsPath = join(dir, 'AGENTS.md');
    writeFileSync(claudePath, claude);
    if (agents !== null) writeFileSync(agentsPath, agents);
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--claude', claudePath, '--agents', agentsPath, ...extra],
      // cwd distinto de la raíz: nada debe depender del directorio de trabajo.
      { cwd: dir, encoding: 'utf8' },
    );
    /** @type {string | null} */
    let written = null;
    try {
      written = readFileSync(agentsPath, 'utf8');
    } catch {
      /* el archivo no existe */
    }
    return { status: result.status, stderr: result.stderr, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('extrae solo los bloques marcados y en orden', () => {
  const out = buildAgentsMd(SAMPLE);
  assert.ok(out.includes('## Regla uno'));
  assert.ok(out.includes('Texto de la regla dos.'));
  assert.ok(out.indexOf('## Regla uno') < out.indexOf('## Regla dos'));
  assert.ok(!out.includes('Fuera uno'));
  assert.ok(!out.includes('Fuera dos'));
  assert.ok(!out.includes(START));
  assert.ok(!out.includes(END));
});

test('antepone la cabecera de archivo generado', () => {
  const out = buildAgentsMd(SAMPLE);
  assert.ok(out.startsWith('# Instrucciones para agentes (Codex y otros) — Proyecto Shiro\n'));
  assert.ok(out.includes('scripts/sync-agents-md.mjs'));
  assert.ok(out.includes('npm run agents:sync'));
  assert.ok(out.indexOf('npm run agents:sync') < out.indexOf('## Regla uno'));
});

test('termina con un único LF y no contiene CR', () => {
  const out = buildAgentsMd(SAMPLE);
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
  assert.ok(!out.includes('\r'));
});

test('normaliza CRLF a LF', () => {
  assert.equal(buildAgentsMd(SAMPLE.replace(/\n/g, '\r\n')), buildAgentsMd(SAMPLE));
});

test('lanza si no hay marcadores', () => {
  assert.throws(() => buildAgentsMd('# Solo título\n\nTexto.\n'), /marcador/i);
});

test('lanza si un marcador de inicio no tiene fin', () => {
  assert.throws(() => buildAgentsMd(`${START}\n\n## Regla\n\nTexto.\n`), /sin .*fin/i);
});

test('lanza si hay un fin sin inicio o un inicio anidado', () => {
  assert.throws(() => buildAgentsMd(`## Regla\n\n${END}\n`), /sin .*inicio/i);
  assert.throws(() => buildAgentsMd(`${START}\n\n${START}\n\nx\n\n${END}\n`), /anidad/i);
});

test('lanza si un bloque enlaza a un ancla que no está en los bloques extraídos', () => {
  const claude = `# T\n\n## Fuera\n\n${START}\n\n## Regla\n\nVer [fuera](#fuera).\n\n${END}\n`;
  assert.throws(() => buildAgentsMd(claude), /#fuera/);
});

test('admite un ancla que apunta a un encabezado de los bloques extraídos', () => {
  const claude = `# T\n\n${START}\n\n## Regla uno\n\nVer [la regla](#regla-uno).\n\n${END}\n`;
  assert.ok(buildAgentsMd(claude).includes('(#regla-uno)'));
});

test('ignora marcadores y enlaces de ejemplo dentro de vallas de código', () => {
  const fence = '```';
  const claude = [
    '# T',
    '',
    '## Cómo se marca',
    '',
    fence,
    START,
    END,
    fence,
    '',
    START,
    '',
    '## Regla',
    '',
    'Texto.',
    '',
    fence,
    START,
    '[ejemplo](#no-existe)',
    fence,
    '',
    END,
    '',
  ].join('\n');
  const out = buildAgentsMd(claude);
  assert.ok(out.includes('## Regla'));
  assert.ok(out.includes('(#no-existe)'));
  assert.ok(!out.includes('Cómo se marca'));
});

test('--check sale con 1 si AGENTS.md no coincide y con 0 si coincide', () => {
  const expected = buildAgentsMd(SAMPLE);
  const ok = runCli(SAMPLE, expected, ['--check']);
  assert.equal(ok.status, 0, ok.stderr);

  const stale = runCli(SAMPLE, expected.replace('Texto de la regla uno.', 'Texto viejo.'), [
    '--check',
  ]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /npm run agents:sync/);
  assert.match(stale.stderr, /Texto viejo\./);
  assert.match(stale.stderr, /Texto de la regla uno\./);
});

test('--check ignora solo la diferencia CRLF/LF del archivo en disco', () => {
  const expected = buildAgentsMd(SAMPLE);
  const crlf = runCli(SAMPLE, expected.replace(/\n/g, '\r\n'), ['--check']);
  assert.equal(crlf.status, 0, crlf.stderr);
});

test('--check sale con 1 si falta AGENTS.md', () => {
  const missing = runCli(SAMPLE, null, ['--check']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /npm run agents:sync/);
});

test('sale con 2 si falta CLAUDE.md, sobra una opción o CLAUDE.md no tiene marcadores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-md-'));
  try {
    const missing = spawnSync(
      process.execPath,
      [SCRIPT, '--claude', join(dir, 'no-existe.md'), '--agents', join(dir, 'AGENTS.md')],
      { encoding: 'utf8' },
    );
    assert.equal(missing.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(runCli(SAMPLE, null, ['--desconocida']).status, 2);
  assert.equal(runCli('# sin marcadores\n', null).status, 2);
});

test('sin --check escribe AGENTS.md con el contenido generado', () => {
  const result = runCli(SAMPLE, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.written, buildAgentsMd(SAMPLE));
});

test('el AGENTS.md del repo coincide con lo que genera CLAUDE.md', () => {
  const claude = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(agents, buildAgentsMd(claude));
});
