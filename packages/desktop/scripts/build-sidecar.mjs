// @ts-check
/**
 * build-sidecar.mjs — empaqueta el `core-host` (proceso Node) como un
 * ejecutable Windows que Tauri lanza como sidecar (ADR 0024 §2).
 *
 * Pipeline:
 *
 *   1. `ncc` bundlea `core-host/dist/server.js` + todas sus deps
 *      (incluido `@proyecto-shiro/core` y `@proyecto-shiro/core/node`,
 *      que son symlinks de workspace) en UN solo `index.cjs`. ncc
 *      resuelve los imports ESM/CJS y los aplana — pkg solo no maneja
 *      bien los symlinks de workspace ni el ESM.
 *
 *   2. `@yao-pkg/pkg` toma ese bundle y produce un `.exe` con el runtime
 *      Node embebido. Nombre con target-triple que Tauri espera para los
 *      sidecars: `core-host-x86_64-pc-windows-msvc.exe`.
 *
 *   3. Copiamos el addon nativo `better_sqlite3.node` junto al `.exe`.
 *      pkg NO empaqueta binarios nativos; el `core-host` los carga en
 *      runtime vía la opción `nativeBinding` de better-sqlite3, que el
 *      lanzador Tauri apunta a este archivo (env `SHIRO_SQLITE_NATIVE_BINDING`).
 *
 * Pre-requisito: `npm run build` (core + core-host) ya ejecutado, porque
 * bundleamos el JS COMPILADO (`dist/server.js`), no el TS.
 *
 * Salida: `packages/desktop/src-tauri/binaries/`.
 *
 * Solo Windows x64 en V1 (ADR 0024 §1). Para otros targets habría que
 * parametrizar el triple y el sufijo del binario nativo.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Rutas ────────────────────────────────────────────────────────────
const desktopDir = resolve(__dirname, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const coreHostDir = join(repoRoot, 'packages', 'core-host');
const serverEntry = join(coreHostDir, 'dist', 'server.js');
const binariesDir = join(desktopDir, 'src-tauri', 'binaries');
const resourcesDir = join(desktopDir, 'src-tauri', 'resources');
const tmpBundleDir = join(desktopDir, '.sidecar-build');

// Configs que el sidecar necesita en runtime. En dev el `core-host` las
// lee con paths relativos al cwd; empaquetado, el lanzador Tauri le pasa
// estas rutas (resueltas vía `resource_dir`) por env var.
const MODULES_CONFIG_SRC = join(repoRoot, 'config', 'modules.config.yaml');
const CHARACTER_SRC = join(
  repoRoot,
  'packages',
  'core',
  'src',
  'character',
  'characters',
  'default.yaml',
);

// Target-triple de Windows x64 (MSVC). Tauri busca el sidecar nombrado
// `<bin>-<triple>(.exe)` y al empaquetar lo renombra a `<bin>`.
const TARGET_TRIPLE = 'x86_64-pc-windows-msvc';
const EXE_NAME = `core-host-${TARGET_TRIPLE}.exe`;
const NATIVE_BINDING = 'better_sqlite3.node';

/** Log con prefijo para distinguir del ruido de ncc/pkg. */
function step(msg) {
  console.log(`\n[build-sidecar] ${msg}`);
}

function fail(msg) {
  console.error(`\n[build-sidecar] ERROR: ${msg}`);
  process.exit(1);
}

// ─── 0. Verificaciones previas ────────────────────────────────────────
if (!existsSync(serverEntry)) {
  fail(
    `no existe ${serverEntry}.\n` +
      `Ejecuta primero:  npm run build -w @proyecto-shiro/core -w @proyecto-shiro/core-host`,
  );
}

if (process.platform !== 'win32') {
  console.warn(
    '[build-sidecar] AVISO: este script empaqueta solo para Windows x64 (ADR 0024). ' +
      'En otra plataforma el .exe resultante no será nativo de tu SO.',
  );
}

mkdirSync(binariesDir, { recursive: true });

// ─── 1. ncc bundle ────────────────────────────────────────────────────
step('1/3 — bundle con ncc…');
rmSync(tmpBundleDir, { recursive: true, force: true });
try {
  // `ncc build <entry> -o <out>` produce <out>/index.js (CJS) con todo
  // aplanado. `--no-source-map-register` evita que inyecte el hook de
  // source-map-support (pkg no lo necesita y a veces choca).
  const nccBin = require.resolve('@vercel/ncc/dist/ncc/cli.js');
  execFileSync(
    process.execPath,
    [nccBin, 'build', serverEntry, '-o', tmpBundleDir, '--no-source-map-register'],
    { stdio: 'inherit', cwd: desktopDir },
  );
} catch {
  fail('ncc falló — revisa el output de arriba.');
}

const bundleEntry = join(tmpBundleDir, 'index.js');
if (!existsSync(bundleEntry)) {
  fail(`ncc no produjo ${bundleEntry}.`);
}

// ─── 2. pkg → .exe ────────────────────────────────────────────────────
step('2/3 — empaquetado con pkg…');
const exeOut = join(binariesDir, EXE_NAME);
try {
  // `pkg <entry> --targets node22-win-x64 --output <exe>`.
  // node22 = runtime embebido. La primera vez pkg descarga el base
  // binary de Node (~40 MB, cacheado en ~/.pkg-cache).
  const pkgBin = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');
  execFileSync(
    process.execPath,
    [pkgBin, bundleEntry, '--targets', 'node22-win-x64', '--output', exeOut],
    { stdio: 'inherit', cwd: desktopDir },
  );
} catch {
  fail('pkg falló — revisa el output de arriba.');
}

if (!existsSync(exeOut)) {
  fail(`pkg no produjo ${exeOut}.`);
}

// ─── 3. Copiar el addon nativo de better-sqlite3 ──────────────────────
step('3/3 — copiando el binario nativo better_sqlite3.node…');
const nativeSrc = findBetterSqliteBinding();
if (nativeSrc === null) {
  fail(
    'no se encontró better_sqlite3.node en node_modules. ' +
      '¿Corriste `npm install` en la raíz? El addon se compila/descarga al instalar.',
  );
}
const nativeDest = join(binariesDir, NATIVE_BINDING);
copyFileSync(nativeSrc, nativeDest);

// ─── 3b. Copiar configs YAML como recursos del sidecar ────────────────
step('copiando configs YAML a resources/…');
mkdirSync(resourcesDir, { recursive: true });
if (!existsSync(MODULES_CONFIG_SRC)) fail(`no existe ${MODULES_CONFIG_SRC}`);
if (!existsSync(CHARACTER_SRC)) fail(`no existe ${CHARACTER_SRC}`);
copyFileSync(MODULES_CONFIG_SRC, join(resourcesDir, 'modules.config.yaml'));
copyFileSync(CHARACTER_SRC, join(resourcesDir, 'default.yaml'));

// ─── Limpieza ─────────────────────────────────────────────────────────
rmSync(tmpBundleDir, { recursive: true, force: true });

step(`✓ Listo. Sidecar en:\n    ${exeOut}\n    ${nativeDest}`);
console.log(
  '\n[build-sidecar] El lanzador Tauri apuntará SHIRO_SQLITE_NATIVE_BINDING a ' +
    `"${NATIVE_BINDING}" junto al .exe en runtime.\n`,
);

/**
 * Localiza el `better_sqlite3.node` resuelto. En un monorepo con hoisting
 * puede estar en la raíz o en el paquete; probamos las ubicaciones
 * habituales en orden.
 * @returns {string | null}
 */
function findBetterSqliteBinding() {
  const candidates = [
    join(repoRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', NATIVE_BINDING),
    join(
      repoRoot,
      'packages',
      'core',
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      NATIVE_BINDING,
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Búsqueda best-effort: better-sqlite3 a veces deja el .node en
  // `build/Release/` con prebuilds; si el layout cambió, escaneamos.
  const releaseDir = join(repoRoot, 'node_modules', 'better-sqlite3', 'build', 'Release');
  if (existsSync(releaseDir)) {
    const found = readdirSync(releaseDir).find((f) => f.endsWith('.node'));
    if (found !== undefined) return join(releaseDir, found);
  }
  return null;
}
