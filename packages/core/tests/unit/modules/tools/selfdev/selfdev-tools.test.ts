/**
 * Tests de las tools de self-dev: la config, el guard de inmutabilidad y
 * las factories. Operan sobre un directorio temporal real que simula el
 * worktree aislado (= un clon de la raíz del repo).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../../../../src/core/event-bus.js';
import { Logger } from '../../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../../src/core/module-loader.js';
import type { ToolContext } from '../../../../../src/interfaces/IToolModule.js';
import {
  SelfDevConfigError,
  createSelfDevFsRegistry,
  createSelfDevShell,
  parseSelfDevConfig,
} from '../../../../../src/modules/tools/selfdev/selfdev-tools.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

function ctx(): ToolContext {
  return { logger: new Logger('error', { module: 'test' }), userId: 'me' };
}

describe('parseSelfDevConfig', () => {
  it('aplica defaults con config vacía', () => {
    const c = parseSelfDevConfig({});
    expect(c.worktree_path).toBe('../shiro-selfdev');
    expect(c.branch_prefix).toBe('shiro/');
    expect(c.eval_commands).toContain('test');
    expect(c.max_fix_iterations).toBe(2);
    expect(c.generation_max_tokens).toBe(16_384);
  });

  it('lanza con valores inválidos', () => {
    expect(() => parseSelfDevConfig({ max_fix_iterations: -1 })).toThrow(SelfDevConfigError);
  });
});

describe('createSelfDevFsRegistry', () => {
  let root: string; // simula el worktree (clon de la raíz del repo)

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-selfdev-')));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function registry() {
    return createSelfDevFsRegistry({
      worktreeRoot: root,
      config: parseSelfDevConfig({}),
      deps: makeDeps(),
    });
  }

  it('expone fs:read/list/write/delete y todas son tier auto', () => {
    const reg = registry();
    expect(
      reg
        .list()
        .map((t) => t.id)
        .sort(),
    ).toEqual(['fs:delete', 'fs:list', 'fs:read', 'fs:write']);
    for (const t of reg.list()) expect(t.permissionTier).toBe('auto');
  });

  it('write a un path normal escribe en el worktree', async () => {
    const res = await registry()
      .get('fs:write')!
      .execute({ path: 'packages/core/src/foo.ts', content: 'export const x = 1;\n' }, ctx());
    expect(res.ok).toBe(true);
    const written = await fs.readFile(join(root, 'packages/core/src/foo.ts'), 'utf8');
    expect(written).toContain('export const x');
  });

  it('write a un archivo INMUTABLE falla con IMMUTABLE_PATH y no toca disco', async () => {
    const target = 'packages/core/src/character/characters/default.yaml';
    const res = await registry()
      .get('fs:write')!
      .execute({ path: target, content: 'pwned' }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('IMMUTABLE_PATH');
    await expect(fs.access(join(root, target))).rejects.toThrow();
  });

  it('delete a un archivo inmutable falla', async () => {
    const res = await registry().get('fs:delete')!.execute({ path: 'docs/adr/0023-x.md' }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('IMMUTABLE_PATH');
  });

  it('read lee del worktree', async () => {
    await fs.writeFile(join(root, 'a.txt'), 'hola', 'utf8');
    const res = await registry().get('fs:read')!.execute({ path: 'a.txt' }, ctx());
    expect(res.ok).toBe(true);
    expect(res.output).toBe('hola');
  });

  it('no puede escapar del worktree', async () => {
    const res = await registry()
      .get('fs:write')!
      .execute({ path: '../fuera.txt', content: 'x' }, ctx());
    expect(res.ok).toBe(false);
  });
});

describe('createSelfDevShell', () => {
  it('respeta el allowlist (git permitido por patrón; rm rechazado)', async () => {
    const config = parseSelfDevConfig({
      shell_commands: [{ cmd: 'git', allowed_args_pattern: '^status$' }],
    });
    const shell = createSelfDevShell({ worktreeRoot: tmpdir(), config });
    const denied = await shell.execute({ command: 'rm', args: ['-rf', '/'] }, ctx());
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('no permitido');
  });
});
