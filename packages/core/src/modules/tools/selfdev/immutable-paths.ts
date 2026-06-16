/**
 * immutable-paths — la lista HARDCODEADA de archivos que Shiro NUNCA puede
 * modificar cuando hace self-improvement (ADR 0023 §3).
 *
 * **Por qué hardcodeada (no leída de config)**: la lista MISMA es una
 * salvaguarda. Si viviera en YAML, Shiro podría —vía un `fs:write` a la
 * config— auto-otorgarse permiso para tocar su carácter, sus ADRs o sus
 * permisos. Al estar en código y fuera del scope de escritura de self-dev,
 * es una frontera **estructural**, no un "diálogo de confirmación".
 *
 * Cubre (rutas relativas a la raíz del repo):
 * - `packages/core/src/character/**` — su personalidad (drift no consentido).
 * - `docs/adr/**` — los ADRs son juicio humano (incluidos 0022 y 0023).
 * - `config/**` — `modules.config.yaml`: no se auto-otorga permisos.
 * - `safety/**` — system prompts / salvaguardas (futuro).
 * - `CLAUDE.md`, `.gitignore`, `.env*` — instrucciones / git / secrets.
 *
 * El check lo aplican `fs:write` / `fs:delete` de self-dev ANTES de tocar el
 * disco; un match devuelve `IMMUTABLE_PATH`, que el LLM ve y debe respetar
 * (proponer el cambio conversacionalmente, no por PR).
 */

/** Normaliza a forma repo-relativa con `/`, sin `./` ni `/` inicial. */
function normalize(repoRelPath: string): string {
  return repoRelPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Prefijos de directorio inmutables (repo-relativos, con `/` final). */
const IMMUTABLE_DIR_PREFIXES = [
  'packages/core/src/character/',
  'docs/adr/',
  'config/',
  'safety/',
] as const;

/** Archivos exactos inmutables. */
const IMMUTABLE_FILES = new Set(['CLAUDE.md', '.gitignore']);

/** Cualquier `character/` bajo `packages/<pkg>/src/` (defensivo). */
const ANY_CHARACTER_DIR = /(?:^|\/)packages\/[^/]+\/src\/character\//;

/**
 * True si `repoRelPath` (relativo a la raíz del repo) está **prohibido**
 * para la escritura/borrado de self-dev. Conservador por diseño: ante la
 * duda, protege.
 */
export function isImmutable(repoRelPath: string): boolean {
  const p = normalize(repoRelPath);
  if (p === '') return true; // la raíz del repo no se escribe
  if (IMMUTABLE_FILES.has(p)) return true;
  if (p === '.env' || p.startsWith('.env.')) return true;
  if (IMMUTABLE_DIR_PREFIXES.some((dir) => p === dir.slice(0, -1) || p.startsWith(dir))) {
    return true;
  }
  if (ANY_CHARACTER_DIR.test(`/${p}`)) return true;
  return false;
}

/** Mensaje de error para un path inmutable — lo recibe el LLM como tool_result. */
export function immutablePathError(repoRelPath: string): string {
  return (
    `IMMUTABLE_PATH: '${repoRelPath}' es un archivo protegido (carácter, ADRs, ` +
    `config de permisos, safety o secrets) — Shiro no puede modificarlo por PR. ` +
    `Si crees que debería cambiar, proponlo en la conversación; no lo edites aquí.`
  );
}
