/**
 * Tests de `linkNodeModules`: enlaza terceros del repo y reapunta el scope
 * `@proyecto-shiro` al worktree. Opera sobre directorios temporales reales que
 * simulan el repo (con node_modules) y el worktree (con packages/*).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeModulesLinkError, linkNodeModules } from '../../../src/selfdev/node-modules-link.js';

describe('linkNodeModules', () => {
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-repo-')));
    worktree = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-wt-')));
    // Repo con node_modules: un paquete suelto, un scope de terceros, .bin,
    // un archivo suelto, y el scope del workspace con sus links.
    await fs.mkdir(join(repo, 'node_modules', 'zod'), { recursive: true });
    await fs.mkdir(join(repo, 'node_modules', '@types', 'node'), { recursive: true });
    await fs.mkdir(join(repo, 'node_modules', '.bin'), { recursive: true });
    await fs.writeFile(join(repo, 'node_modules', '.package-lock.json'), '{}', 'utf8');
    await fs.mkdir(join(repo, 'node_modules', '@proyecto-shiro', 'core'), { recursive: true });
    await fs.mkdir(join(repo, 'node_modules', '@proyecto-shiro', 'core-host'), { recursive: true });
    // Worktree con sus propios packages/*.
    await fs.mkdir(join(worktree, 'packages', 'core'), { recursive: true });
    await fs.mkdir(join(worktree, 'packages', 'core-host'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(worktree, { recursive: true, force: true });
  });

  it('enlaza los paquetes de terceros hacia el repo', async () => {
    await linkNodeModules(repo, worktree);
    expect(await fs.realpath(join(worktree, 'node_modules', 'zod'))).toBe(
      await fs.realpath(join(repo, 'node_modules', 'zod')),
    );
    expect(await fs.realpath(join(worktree, 'node_modules', '@types'))).toBe(
      await fs.realpath(join(repo, 'node_modules', '@types')),
    );
    expect(await fs.realpath(join(worktree, 'node_modules', '.bin'))).toBe(
      await fs.realpath(join(repo, 'node_modules', '.bin')),
    );
  });

  it('reapunta @proyecto-shiro/* al worktree, NO al repo', async () => {
    await linkNodeModules(repo, worktree);
    expect(await fs.realpath(join(worktree, 'node_modules', '@proyecto-shiro', 'core'))).toBe(
      await fs.realpath(join(worktree, 'packages', 'core')),
    );
    expect(await fs.realpath(join(worktree, 'node_modules', '@proyecto-shiro', 'core-host'))).toBe(
      await fs.realpath(join(worktree, 'packages', 'core-host')),
    );
  });

  it('no enlaza archivos sueltos del node_modules (solo directorios)', async () => {
    await linkNodeModules(repo, worktree);
    await expect(fs.access(join(worktree, 'node_modules', '.package-lock.json'))).rejects.toThrow();
  });

  it('es idempotente: una segunda corrida no lanza', async () => {
    await linkNodeModules(repo, worktree);
    await expect(linkNodeModules(repo, worktree)).resolves.toBeUndefined();
  });

  it('lanza si el repo no tiene node_modules', async () => {
    const emptyRepo = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-empty-')));
    try {
      await expect(linkNodeModules(emptyRepo, worktree)).rejects.toBeInstanceOf(
        NodeModulesLinkError,
      );
    } finally {
      await fs.rm(emptyRepo, { recursive: true, force: true });
    }
  });
});
