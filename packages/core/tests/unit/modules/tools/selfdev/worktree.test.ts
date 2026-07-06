/**
 * Tests del WorktreeManager (ADR 0023 §2).
 *
 * - Unit: `GitExec` mockeado → verifica los args git construidos para cada
 *   caso (crear con `-b`, reutilizar rama, reutilizar worktree, base, remove).
 * - Integración: contra `git` real en un repo temporal → crea y elimina un
 *   worktree de verdad. (Spawnea git; vive aislada por si parpadea bajo carga.)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../../../../src/core/event-bus.js';
import { Logger } from '../../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../../src/core/module-loader.js';
import { parseSelfDevConfig } from '../../../../../src/modules/tools/selfdev/selfdev-tools.js';
import {
  WorktreeManager,
  createWorktreeManager,
  slugTopic,
  type GitExec,
} from '../../../../../src/modules/tools/selfdev/worktree.js';

function logger(): Logger {
  return new Logger('error', { module: 'test' });
}
function makeDeps(): ModuleDeps {
  const log = logger();
  return { logger: log, bus: new EventBus({ logger: log }) };
}

interface FakeGit {
  gitExec: GitExec;
  calls: string[][];
}
function fakeGit(opts: { worktrees?: string[]; branches?: string[] } = {}): FakeGit {
  const calls: string[][] = [];
  const gitExec: GitExec = (args) => {
    calls.push(args);
    if (args[0] === 'worktree' && args[1] === 'list') {
      return Promise.resolve({
        ok: true,
        output: (opts.worktrees ?? []).map((w) => `worktree ${w}`).join('\n'),
      });
    }
    if (args[0] === 'rev-parse') {
      const ref = (args[args.length - 1] ?? '').replace('refs/heads/', '');
      return Promise.resolve({ ok: (opts.branches ?? []).includes(ref), output: '' });
    }
    return Promise.resolve({ ok: true, output: 'ok' });
  };
  return { gitExec, calls };
}
function mgr(fake: FakeGit, worktreePath: string): WorktreeManager {
  return new WorktreeManager({
    gitExec: fake.gitExec,
    worktreePath,
    repoRoot: join(tmpdir(), 'shiro-repo-fake'),
    branchPrefix: 'shiro/',
    logger: logger(),
  });
}

describe('slugTopic', () => {
  it('convierte a slug de rama válido', () => {
    expect(slugTopic('Fix the Lip-Sync!')).toBe('fix-the-lip-sync');
    expect(slugTopic('  hola   mundo  ')).toBe('hola-mundo');
    expect(slugTopic('')).toBe('cambios');
    expect(slugTopic('!!!')).toBe('cambios');
  });
});

describe('WorktreeManager.ensure (git mockeado)', () => {
  const wt = join(tmpdir(), 'shiro-selfdev-fake');

  it('crea con -b cuando la rama no existe', async () => {
    const fake = fakeGit({ worktrees: [], branches: [] });
    const r = await mgr(fake, wt).ensure('mi topic');
    expect(r.ok).toBe(true);
    expect(r.branch).toBe('shiro/mi-topic');
    expect(r.reused).toBe(false);
    const add = fake.calls.find((c) => c[0] === 'worktree' && c[1] === 'add')!;
    expect(add).toContain('-b');
    expect(add).toContain('shiro/mi-topic');
  });

  it('incluye el base cuando se pasa', async () => {
    const fake = fakeGit({ branches: [] });
    await mgr(fake, wt).ensure('topic', 'develop');
    const add = fake.calls.find((c) => c[1] === 'add')!;
    expect(add[add.length - 1]).toBe('develop');
  });

  it('checkoutea la rama existente sin -b', async () => {
    const fake = fakeGit({ branches: ['shiro/topic'] });
    await mgr(fake, wt).ensure('topic');
    const add = fake.calls.find((c) => c[1] === 'add')!;
    expect(add).not.toContain('-b');
    expect(add).toContain('shiro/topic');
  });

  it('reutiliza el worktree si ya existe (no llama add)', async () => {
    const fake = fakeGit({ worktrees: [wt] });
    const r = await mgr(fake, wt).ensure('topic');
    expect(r.reused).toBe(true);
    expect(fake.calls.some((c) => c[0] === 'worktree' && c[1] === 'add')).toBe(false);
  });
});

describe('WorktreeManager.remove (git mockeado)', () => {
  const wt = join(tmpdir(), 'shiro-selfdev-fake');

  it('no-op si el worktree no existe', async () => {
    const fake = fakeGit({ worktrees: [] });
    const r = await mgr(fake, wt).remove();
    expect(r.ok).toBe(true);
    expect(fake.calls.some((c) => c[1] === 'remove')).toBe(false);
  });

  it('llama worktree remove --force si existe', async () => {
    const fake = fakeGit({ worktrees: [wt] });
    await mgr(fake, wt).remove();
    const rm = fake.calls.find((c) => c[1] === 'remove')!;
    expect(rm).toContain('--force');
  });

  it('borra el worktree en disco (incl. junctions) sin seguir al target', async () => {
    // Regresión del bug de Windows: `git worktree remove` deja el node_modules
    // enlazado (junctions) y el próximo `add` falla. remove() borra el dir con
    // fs.rm (junction-safe): quita los enlaces sin tocar su target.
    const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-rm-')));
    const wtDir = join(base, 'wt');
    const target = join(base, 'target', 'pkg');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(join(target, 'keep.txt'), 'keep');
    await fs.mkdir(join(wtDir, 'node_modules'), { recursive: true });
    await fs.symlink(target, join(wtDir, 'node_modules', 'pkg'), 'junction');

    const fake = fakeGit({ worktrees: [wtDir] });
    const m = new WorktreeManager({
      gitExec: fake.gitExec,
      worktreePath: wtDir,
      repoRoot: base,
      branchPrefix: 'shiro/',
      logger: logger(),
    });
    const r = await m.remove();
    expect(r.ok).toBe(true);
    await expect(fs.access(wtDir)).rejects.toThrow(); // worktree borrado
    await expect(fs.access(join(target, 'keep.txt'))).resolves.toBeUndefined(); // target intacto
    await fs.rm(base, { recursive: true, force: true });
  });

  it('el guard evita borrar la raíz del repo si worktree_path resuelve a ella', async () => {
    const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-guard-')));
    await fs.writeFile(join(base, 'important.txt'), 'x');
    const fake = fakeGit({ worktrees: [] });
    const m = new WorktreeManager({
      gitExec: fake.gitExec,
      worktreePath: base, // == repoRoot → inseguro
      repoRoot: base,
      branchPrefix: 'shiro/',
      logger: logger(),
    });
    await m.remove();
    await expect(fs.access(join(base, 'important.txt'))).resolves.toBeUndefined(); // sobrevivió
    await fs.rm(base, { recursive: true, force: true });
  });
});

// ─── Integración con git real ─────────────────────────────────────────

function git(cwd: string, args: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn('git', args, { cwd, shell: false });
    child.on('close', (code) => res(code ?? 1));
    child.on('error', () => res(1));
  });
}

describe('WorktreeManager — integración con git real', () => {
  let repo: string;
  let wtPath: string;

  beforeEach(async () => {
    repo = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'shiro-repo-')));
    wtPath = join(tmpdir(), `shiro-wt-${String(process.pid)}-${String(Date.now())}`);
    await git(repo, ['init']);
    await git(repo, ['config', 'user.email', 't@t.test']);
    await git(repo, ['config', 'user.name', 'test']);
    await git(repo, ['commit', '--allow-empty', '-m', 'init']);
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(wtPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('crea, reutiliza y elimina un worktree real', async () => {
    const config = parseSelfDevConfig({
      worktree_path: wtPath,
      shell_commands: [{ cmd: 'git', allowed_args_pattern: '^(worktree|rev-parse)\\b' }],
    });
    const m = createWorktreeManager({ repoRoot: repo, config, deps: makeDeps() });

    const created = await m.ensure('mi-topic');
    expect(created.ok).toBe(true);
    expect(created.reused).toBe(false);
    expect(created.branch).toBe('shiro/mi-topic');
    await expect(fs.access(wtPath)).resolves.toBeUndefined();

    const again = await m.ensure('mi-topic');
    expect(again.reused).toBe(true);

    const removed = await m.remove();
    expect(removed.ok).toBe(true);
    await expect(fs.access(wtPath)).rejects.toThrow();
  }, 30_000);
});
