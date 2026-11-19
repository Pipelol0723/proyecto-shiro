// @ts-check
// La versión de Node se decide en un solo sitio (`.node-version`) y la siguen
// el CI, el release, `engines` y el sidecar (P-28). Se ejecuta con
// `npm run test:scripts`.
//
// Por qué importa: el binario lleva dentro su propio Node y, al lado, el addon
// nativo de better-sqlite3 tal como lo dejó `npm install`. Si se instaló con
// otro Node, el addon es de otro ABI y el binario falla al abrir la memoria.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  PKG_TARGET,
  SIDECAR_NODE_MAJOR,
  checkBindingLoads,
  checkBuildNode,
} from '../packages/desktop/scripts/sidecar-abi.mjs';

/** @param {string} path ruta relativa a la raíz del repo */
function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

/**
 * El texto de un job de un workflow: desde su cabecera hasta la del siguiente.
 * @param {string} text contenido del workflow
 * @param {string} job nombre del job
 */
function jobBlock(text, job) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `no existe el job ${job}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[\w-]+:\s*$/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

test('.node-version, engines y el sidecar dicen la misma versión', () => {
  const pinned = read('.node-version').trim();
  assert.equal(pinned, String(SIDECAR_NODE_MAJOR));
  assert.equal(PKG_TARGET, `node${pinned}-win-x64`);

  // Un rango dentro de esa versión mayor: el mínimo lo ponen las herramientas
  // (ver docs/plan-implementacion-2026-11/versiones.md, V5c).
  const pkg = /** @type {{ engines?: { node?: string } }} */ (JSON.parse(read('package.json')));
  const range = new RegExp(`^>=${pinned}\\.\\d+ <${String(Number(pinned) + 1)}$`);
  assert.match(pkg.engines?.node ?? '', range);
});

test('los workflows leen la versión de .node-version, no la repiten', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const text = read(file);
    const setups = text.match(/uses:\s*actions\/setup-node@/g) ?? [];
    const fromFile = text.match(/node-version-file:\s*['"]?\.node-version['"]?/g) ?? [];
    assert.ok(setups.length > 0, `${file}: no usa setup-node`);
    assert.equal(fromFile.length, setups.length, `${file}: algún setup-node no lee .node-version`);
    assert.doesNotMatch(text, /^\s*node-version:/m, `${file}: fija la versión a mano`);
  }
});

test('el sidecar se empaqueta con el target que sale de la versión fijada', () => {
  const script = read('packages/desktop/scripts/build-sidecar.mjs');
  // Lo que se le pasa a pkg, no solo que el nombre aparezca importado.
  assert.match(script, /'--targets',\s*PKG_TARGET\b/);
  assert.doesNotMatch(script, /['"`]node\d+-win-x64['"`]/);
});

test('con el Node del sidecar se puede empaquetar', () => {
  assert.equal(checkBuildNode(`${String(SIDECAR_NODE_MAJOR)}.20.0`), null);
});

test('con otro Node no: lo dice con las dos versiones y qué hacer', () => {
  for (const version of ['20.11.1', '24.0.0']) {
    const problem = checkBuildNode(version);
    assert.ok(problem !== null);
    assert.match(problem, new RegExp(version.replaceAll('.', '\\.')));
    assert.match(problem, new RegExp(`Node ${String(SIDECAR_NODE_MAJOR)}`));
  }
  assert.ok(checkBuildNode('') !== null);
  assert.ok(checkBuildNode('no-es-una-versión') !== null);
});

test('un addon que carga en este Node vale', () => {
  /** @type {string[]} */
  const loaded = [];
  const problem = checkBindingLoads('C:/x/better_sqlite3.node', (path) => {
    loaded.push(path);
  });
  assert.equal(problem, null);
  assert.deepEqual(loaded, ['C:/x/better_sqlite3.node']);
});

test('un addon de otro ABI no: lo dice con el motivo y cómo arreglarlo', () => {
  const problem = checkBindingLoads('C:/x/better_sqlite3.node', () => {
    throw new Error(
      'was compiled against a different Node.js version using NODE_MODULE_VERSION 115',
    );
  });
  assert.ok(problem !== null);
  assert.match(problem, /NODE_MODULE_VERSION 115/);
  assert.match(problem, /npm rebuild better-sqlite3/);
});

test('el CI verifica también en Windows y aplica la cobertura de core', () => {
  const ci = read('.github/workflows/ci.yml');

  // La cobertura va dentro del job obligatorio: fuera de él no impediría fusionar.
  const verify = jobBlock(ci, 'verify');
  assert.match(verify, /run: npm run verify\s*$/m);
  assert.match(verify, /run: npm run test:coverage -w @proyecto-shiro\/core\s*$/m);

  const windows = jobBlock(ci, 'verify-windows');
  assert.match(windows, /runs-on:\s*windows-latest/);
  assert.match(windows, /run: npm run verify\s*$/m);

  const core = /** @type {{ scripts?: Record<string, string> }} */ (
    JSON.parse(read('packages/core/package.json'))
  );
  assert.equal(core.scripts?.['test:coverage'], 'vitest run --coverage');
});
