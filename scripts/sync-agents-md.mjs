// @ts-check
/**
 * sync-agents-md.mjs — genera AGENTS.md desde CLAUDE.md (ítem P-03, ADR 0029).
 *
 * AGENTS.md es un extracto corto y estable de CLAUDE.md (reglas duras y
 * comandos) para las herramientas que solo leen AGENTS.md. Se construye con
 * los tramos de CLAUDE.md encerrados entre `<!-- agents-md:start -->` y
 * `<!-- agents-md:end -->` (cada marcador en su propia línea), en el orden en
 * que aparecen, tras una cabecera fija. Qué secciones van en el extracto lo
 * decide CLAUDE.md con esos marcadores, no este script.
 *
 * Los enlaces relativos valen igual en AGENTS.md porque los dos archivos están
 * en la raíz. Un enlace a un ancla interna (`](#…)`) solo vale si el
 * encabezado está dentro de los tramos extraídos; si no, se lanza un error.
 *
 * Códigos de salida: 0 hecho o coincide · 1 `--check` y AGENTS.md no coincide ·
 * 2 error de uso o de lectura (marcadores mal puestos, archivo ilegible, opción
 * desconocida).
 *
 * Uso: node scripts/sync-agents-md.mjs [--check] [--claude ruta] [--agents ruta]
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const START_MARKER = '<!-- agents-md:start -->';
const END_MARKER = '<!-- agents-md:end -->';
const CLI_FLAGS = new Set(['--check']);
const CLI_OPTIONS = new Set(['--claude', '--agents']);
const DIFF_LINES = 5;
const DEFAULT_CLAUDE = fileURLToPath(new URL('../CLAUDE.md', import.meta.url));
const DEFAULT_AGENTS = fileURLToPath(new URL('../AGENTS.md', import.meta.url));

// Texto constante: sin fechas ni estado de hitos, para que no caduque.
const HEADER = [
  '# Instrucciones para agentes (Codex y otros) — Proyecto Shiro',
  '',
  '> **Archivo generado** desde [`CLAUDE.md`](CLAUDE.md) por `scripts/sync-agents-md.mjs`. No se edita a mano: edita CLAUDE.md y ejecuta `npm run agents:sync`. CLAUDE.md es la única fuente de instrucciones para agentes ([ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md)); este archivo es un extracto de sus reglas duras y comandos.',
  '',
  'Proyecto Shiro es un AI Companion modular tipo VTuber con voz, memoria y avatar, mantenido por una persona con agentes de IA como apoyo.',
  '',
  'El estado de los hitos y la hoja de ruta viven **solo** en la tabla [Roadmap del README](README.md#roadmap).',
  '',
  'Antes de algo estructural, lee CLAUDE.md, [`docs/architecture.md`](docs/architecture.md) y [`docs/adr/`](docs/adr/). Antes de tocar fronteras de confianza, lee la tabla SEC-xx de [`docs/security-review-2026-07.md`](docs/security-review-2026-07.md) y el [ADR 0027](docs/adr/0027-autenticacion-token-bus-stt-multicliente.md).',
].join('\n');

/**
 * Convierte el texto de un encabezado en el ancla que genera GitHub.
 * @param {string} heading
 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * Lanza si algún tramo enlaza a un ancla que AGENTS.md no tendría.
 * @param {string[]} lines líneas de los tramos extraídos
 */
function assertAnchorsResolve(lines) {
  let inFence = false;
  const slugs = new Set();
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) slugs.add(slugify(heading[1]));
  }
  const missing = new Set();
  for (const match of lines.join('\n').matchAll(/\]\(#([^)\s]*)\)/g)) {
    if (!slugs.has(match[1])) missing.add(`#${match[1]}`);
  }
  if (missing.size > 0) {
    throw new Error(
      `un bloque marcado enlaza a un ancla de CLAUDE.md que no existiría en AGENTS.md: ${[...missing].join(', ')}. ` +
        'Cambia el enlace a una ruta de archivo o incluye esa sección entre los marcadores.',
    );
  }
}

/**
 * Construye el contenido de AGENTS.md a partir del de CLAUDE.md.
 *
 * @param {string} claudeMd contenido de CLAUDE.md (con LF o CRLF)
 * @returns {string} contenido de AGENTS.md: LF y un único salto de línea final
 */
export function buildAgentsMd(claudeMd) {
  const lines = claudeMd.replace(/\r\n?/g, '\n').split('\n');
  /** @type {string[][]} */
  const blocks = [];
  /** @type {string[] | null} */
  let open = null;
  let openAt = 0;
  lines.forEach((line, index) => {
    const marker = line.trim();
    const at = index + 1;
    if (marker === START_MARKER) {
      if (open)
        throw new Error(
          `marcador de inicio anidado en la línea ${at} (el de la línea ${openAt} sigue abierto)`,
        );
      open = [];
      openAt = at;
    } else if (marker === END_MARKER) {
      if (!open) throw new Error(`marcador de fin sin inicio en la línea ${at}`);
      blocks.push(open);
      open = null;
    } else if (open) {
      open.push(line);
    }
  });
  if (open) throw new Error(`marcador de inicio sin fin (línea ${openAt})`);
  if (blocks.length === 0) {
    throw new Error(`CLAUDE.md no tiene marcadores ${START_MARKER} … ${END_MARKER}`);
  }

  const bodies = blocks.map((block) => block.join('\n').trim()).filter((body) => body !== '');
  if (bodies.length === 0) throw new Error('los marcadores de CLAUDE.md no encierran nada');
  assertAnchorsResolve(bodies.join('\n\n').split('\n'));
  return `${HEADER}\n\n${bodies.join('\n\n')}\n`;
}

/**
 * Primeras líneas que difieren, para el mensaje de `--check`.
 * @param {string} expected
 * @param {string} actual
 */
function describeDiff(expected, actual) {
  const want = expected.split('\n');
  const have = actual.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(want.length, have.length) && out.length < DIFF_LINES * 2; i += 1) {
    if (want[i] === have[i]) continue;
    out.push(`  línea ${i + 1}:`);
    out.push(`    - AGENTS.md:  ${have[i] ?? '(no existe)'}`);
    out.push(`    + generado:   ${want[i] ?? '(no existe)'}`);
    if (out.length >= DIFF_LINES * 3) break;
  }
  return out.join('\n');
}

/**
 * @param {string[]} argv
 * @param {string} flag
 * @returns {string | undefined}
 */
function option(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} necesita un valor`);
  return value;
}

/**
 * @param {string} path
 * @param {string} label
 */
function readText(path, label) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`no se pudo leer ${label} (${path}): ${/** @type {Error} */ (error).message}`);
  }
}

/** @param {string[]} argv */
function main(argv) {
  try {
    const values = new Set();
    argv.forEach((arg, index) => {
      if (CLI_OPTIONS.has(arg)) values.add(index + 1);
    });
    const stray = argv.filter(
      (arg, index) => !values.has(index) && !CLI_FLAGS.has(arg) && !CLI_OPTIONS.has(arg),
    );
    if (stray.length > 0) throw new Error(`opción desconocida: ${stray.join(' ')}`);
    const claudePath = option(argv, '--claude') ?? DEFAULT_CLAUDE;
    const agentsPath = option(argv, '--agents') ?? DEFAULT_AGENTS;
    const expected = buildAgentsMd(readText(claudePath, 'CLAUDE.md'));

    if (!argv.includes('--check')) {
      writeFileSync(agentsPath, expected);
      console.log(`AGENTS.md generado (${expected.split('\n').length - 1} líneas).`);
      return 0;
    }
    let actual = '';
    try {
      // Solo se ignora CRLF/LF: en Windows el archivo de trabajo puede tener CRLF.
      actual = readFileSync(agentsPath, 'utf8').replace(/\r\n?/g, '\n');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        throw new Error(
          `no se pudo leer AGENTS.md (${agentsPath}): ${/** @type {Error} */ (error).message}`,
        );
      }
    }
    if (actual === expected) {
      console.log('AGENTS.md está al día con CLAUDE.md.');
      return 0;
    }
    console.error(
      'AGENTS.md no coincide con lo que genera CLAUDE.md. Ejecuta `npm run agents:sync` y añade el resultado al commit.\n' +
        `Primeras diferencias:\n${describeDiff(expected, actual)}`,
    );
    return 1;
  } catch (error) {
    console.error(`sync-agents-md: ${/** @type {Error} */ (error).message}`);
    return 2;
  }
}

/**
 * ¿Se ejecutó este archivo como programa? Con `realpath` en los dos lados:
 * Node resuelve los enlaces en `import.meta.url` pero no en `argv[1]`.
 */
function isMainModule() {
  try {
    const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
    return invoked === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = main(process.argv.slice(2));
}
