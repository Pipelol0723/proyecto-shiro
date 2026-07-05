/**
 * `linkNodeModules` — prepara el `node_modules` del worktree aislado de self-dev
 * SIN correr `npm ci` (que tardaría minutos por sesión). Enlaza cada dependencia
 * de **terceros** del `node_modules` del repo principal (mismo `package-lock`,
 * así que mismas versiones) y apunta los paquetes del **workspace**
 * (`@proyecto-shiro/*`) a los del **propio worktree** — para que `build`,
 * `typecheck` y `test` validen el código del worktree y no el del repo.
 *
 * ¿Por qué no un único junction `node_modules → repo`? Porque los symlinks que
 * npm crea dentro para el workspace (`@proyecto-shiro/core → ../packages/core`)
 * son **relativos** y resolverían al repo, no al worktree. Enlazando
 * entrada-por-entrada podemos sobreescribir SOLO el scope `@proyecto-shiro`
 * hacia el worktree y dejar todo lo demás apuntando al repo.
 *
 * Cross-package: en este monorepo `@proyecto-shiro/core` se consume por su
 * `dist` construido (no hay `paths` de tsconfig ni alias de vitest), así que el
 * `SelfDevSession` reconstruye `core` en el worktree antes del eval. Este helper
 * solo se encarga del enlazado; el build lo dispara la sesión.
 *
 * Windows: usa **junctions** (`fs.symlink(..., 'junction')`), que no requieren
 * privilegios de admin (a diferencia de los symlinks de directorio). Idempotente:
 * las entradas que ya existen se saltan. Node-only (`@proyecto-shiro/core-host`).
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/** Scope del workspace que se apunta al worktree en vez de al repo. */
const WORKSPACE_SCOPE = '@proyecto-shiro';

export class NodeModulesLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeModulesLinkError';
  }
}

/** True si la ruta existe (sin seguir el symlink — detecta enlaces ya creados). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Crea un enlace de directorio `linkPath → target`. En Windows usa `junction`
 * (target absoluto, sin admin); en POSIX un symlink de tipo `dir`. No-op si
 * `linkPath` ya existe.
 */
async function linkDir(target: string, linkPath: string): Promise<void> {
  if (await pathExists(linkPath)) return;
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(target, linkPath, type);
}

/**
 * Enlaza el `node_modules` del worktree a partir del repo principal.
 *
 * @param repoRoot Raíz del repo (tiene `node_modules` instalado).
 * @param worktreePath Raíz del worktree aislado (tiene `packages/*` pero no deps).
 * @throws {NodeModulesLinkError} si el repo no tiene `node_modules` instalado.
 */
export async function linkNodeModules(repoRoot: string, worktreePath: string): Promise<void> {
  const repoNodeModules = join(repoRoot, 'node_modules');
  if (!(await pathExists(repoNodeModules))) {
    throw new NodeModulesLinkError(
      `el repo no tiene node_modules en ${repoNodeModules} — corré 'npm install' antes de usar self-dev`,
    );
  }
  const worktreeNodeModules = join(worktreePath, 'node_modules');
  await fs.mkdir(worktreeNodeModules, { recursive: true });

  // 1. Terceros: cada entrada de directorio del node_modules del repo →
  //    junction al repo. Excepto el scope del workspace (se maneja abajo).
  //    Los archivos sueltos (`.package-lock.json`, `.modules.yaml`) no hacen
  //    falta para la resolución de módulos, así que se saltan.
  const entries = await fs.readdir(repoNodeModules, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === WORKSPACE_SCOPE) continue;
    if (!entry.isDirectory()) continue;
    await linkDir(join(repoNodeModules, entry.name), join(worktreeNodeModules, entry.name));
  }

  // 2. Workspace: `@proyecto-shiro/<pkg>` → el paquete del PROPIO worktree, no
  //    el del repo. Usa los nombres de link que npm ya creó en el repo (core,
  //    core-host, desktop) y los reapunta a `<worktree>/packages/<pkg>`.
  const repoScope = join(repoNodeModules, WORKSPACE_SCOPE);
  if (await pathExists(repoScope)) {
    const worktreeScope = join(worktreeNodeModules, WORKSPACE_SCOPE);
    await fs.mkdir(worktreeScope, { recursive: true });
    const pkgs = await fs.readdir(repoScope, { withFileTypes: true });
    for (const pkg of pkgs) {
      // Cada link del scope apunta a `packages/<pkg>` (dir === nombre del link
      // en este repo). Lo reapuntamos al worktree.
      await linkDir(join(worktreePath, 'packages', pkg.name), join(worktreeScope, pkg.name));
    }
  }
}
