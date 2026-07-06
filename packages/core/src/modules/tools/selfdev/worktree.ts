/**
 * WorktreeManager (ADR 0023 §2) — envuelve `git worktree` para que Shiro
 * trabaje en un checkout **aislado** (`../shiro-selfdev`) sobre una rama
 * `shiro/<topic>`, sin pisar el working tree del usuario en VS Code.
 *
 * Corre los comandos git **desde la raíz del repo** (no desde el worktree,
 * que aún no existe al crearlo). Es un helper del orquestador (`SelfDevSession`,
 * PR posterior), no una tool del LLM: ejecuta un set FIJO de subcomandos
 * (`worktree add/remove/list`, `rev-parse`) con args que controla el código,
 * no el modelo. Reusa `ShellExecTool` del ADR 0022 (allowlist + spawn sin
 * shell + timeout).
 *
 * Idempotente: si el worktree ya existe en la ruta, `ensure` lo reutiliza en
 * vez de fallar. `remove` es no-op si no existe.
 *
 * Node-only (`@proyecto-shiro/core/node`).
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from '../../../core/logger.js';
import type { ModuleDeps } from '../../../core/module-loader.js';
import { ShellAllowlist, ShellExecTool } from '../shell/shell-tool.js';
import type { SelfDevConfig } from './selfdev-tools.js';

export interface GitResult {
  ok: boolean;
  output: string;
  error?: string;
}

/** Ejecuta `git <args>` desde la raíz del repo. Inyectable para tests. */
export type GitExec = (args: string[]) => Promise<GitResult>;

export interface WorktreeInfo {
  ok: boolean;
  /** Ruta absoluta del worktree. */
  worktreePath: string;
  /** Rama `shiro/<topic>`. */
  branch: string;
  /** True si el worktree ya existía y se reutilizó. */
  reused?: boolean;
  error?: string;
}

/** Normaliza una ruta para comparar (case-insensitive solo en Windows). */
function normalizePath(p: string): string {
  const n = resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/**
 * Convierte un topic libre en un slug válido para rama git: minúsculas,
 * no-alfanuméricos → `-`, recorta y limita longitud. Fallback `cambios`.
 */
export function slugTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'cambios';
}

export class WorktreeManager {
  private readonly gitExec: GitExec;
  private readonly worktreePath: string;
  private readonly repoRoot: string;
  private readonly branchPrefix: string;
  private readonly logger: Logger;

  constructor(opts: {
    gitExec: GitExec;
    /** Ruta absoluta del worktree. */
    worktreePath: string;
    /** Raíz del repo — guard para no `fs.rm` el repo por una config errónea. */
    repoRoot: string;
    branchPrefix: string;
    logger: Logger;
  }) {
    this.gitExec = opts.gitExec;
    this.worktreePath = opts.worktreePath;
    this.repoRoot = opts.repoRoot;
    this.branchPrefix = opts.branchPrefix;
    this.logger = opts.logger;
  }

  /** Rama que le corresponde a un topic (p.ej. `shiro/fix-lip-sync`). */
  branchFor(topic: string): string {
    return `${this.branchPrefix}${slugTopic(topic)}`;
  }

  /**
   * Crea (o reutiliza) el worktree en `worktreePath` sobre `shiro/<topic>`.
   * Si la rama ya existe la checkoutea; si no, la crea (`-b`). `base` opcional
   * es el committish desde el que ramificar (p.ej. `develop`).
   */
  async ensure(topic: string, base?: string): Promise<WorktreeInfo> {
    const branch = this.branchFor(topic);
    if (await this.worktreeExists()) {
      this.logger.info(`worktree reutilizado en ${this.worktreePath}`);
      return { ok: true, worktreePath: this.worktreePath, branch, reused: true };
    }
    const branchExists = await this.branchExists(branch);
    const args = branchExists
      ? ['worktree', 'add', this.worktreePath, branch]
      : ['worktree', 'add', this.worktreePath, '-b', branch, ...(base ? [base] : [])];
    const r = await this.gitExec(args);
    if (!r.ok) {
      // Prefiere la salida real de git (p.ej. "fatal: … already exists") sobre
      // el genérico "código 128" del ShellExecTool — el SelfDevSession la reporta.
      const detail = r.output && r.output !== '(sin salida)' ? r.output : (r.error ?? 'git falló');
      return { ok: false, worktreePath: this.worktreePath, branch, error: detail };
    }
    this.logger.info(`worktree creado en ${this.worktreePath} (rama ${branch})`);
    return { ok: true, worktreePath: this.worktreePath, branch, reused: false };
  }

  /**
   * Elimina el worktree por completo. En Windows, `git worktree remove` deja el
   * directorio cuando contiene junctions (el node_modules enlazado que git no
   * borra), y entonces el próximo `git worktree add` falla con "already exists".
   * Por eso, tras el remove de git, borramos el directorio a mano con `fs.rm`
   * (junction-safe: quita los enlaces sin seguir al target, así el node_modules
   * del repo queda intacto) y hacemos `prune`. No-op si no había nada.
   */
  async remove(): Promise<GitResult> {
    if (await this.worktreeExists()) {
      await this.gitExec(['worktree', 'remove', this.worktreePath, '--force']);
    }
    if (this.isSafeToDelete()) {
      await fs.rm(this.worktreePath, { recursive: true, force: true });
    } else {
      this.logger.warn(`no borro ${this.worktreePath}: contiene o es la raíz del repo`);
    }
    await this.gitExec(['worktree', 'prune']);
    this.logger.info(`worktree eliminado: ${this.worktreePath}`);
    return { ok: true, output: 'worktree eliminado' };
  }

  /** Guard para el `fs.rm`: el worktree no debe ser la raíz del repo ni un ancestro. */
  private isSafeToDelete(): boolean {
    const wt = normalizePath(this.worktreePath);
    const repo = normalizePath(this.repoRoot);
    return wt !== repo && !repo.startsWith(`${wt}/`);
  }

  /** True si hay un worktree registrado en `worktreePath`. */
  async worktreeExists(): Promise<boolean> {
    const r = await this.gitExec(['worktree', 'list', '--porcelain']);
    if (!r.ok) return false;
    const target = normalizePath(this.worktreePath);
    return r.output
      .split(/\r?\n/)
      .filter((l) => l.startsWith('worktree '))
      .some((l) => normalizePath(l.slice('worktree '.length).trim()) === target);
  }

  /** True si la rama local existe ya. */
  private async branchExists(branch: string): Promise<boolean> {
    const r = await this.gitExec(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return r.ok;
  }
}

/**
 * Construye un `WorktreeManager` con un `GitExec` real: un `ShellExecTool`
 * scoped a la **raíz del repo** con el allowlist de self-dev (que debe permitir
 * `git worktree` y `git rev-parse`). Lo usa el `SelfDevSession`.
 */
export function createWorktreeManager(opts: {
  repoRoot: string;
  config: SelfDevConfig;
  deps: ModuleDeps;
}): WorktreeManager {
  const { repoRoot, config, deps } = opts;
  const shell = new ShellExecTool(
    new ShellAllowlist(config.shell_commands),
    repoRoot,
    config.shell_timeout_ms,
  );
  const logger = deps.logger.child({ module: 'WorktreeManager' });
  const gitExec: GitExec = async (args) => {
    const r = await shell.execute({ command: 'git', args }, { logger, userId: 'selfdev' });
    return { ok: r.ok, output: r.output, error: r.error };
  };
  return new WorktreeManager({
    gitExec,
    worktreePath: resolve(repoRoot, config.worktree_path),
    repoRoot,
    branchPrefix: config.branch_prefix,
    logger,
  });
}
