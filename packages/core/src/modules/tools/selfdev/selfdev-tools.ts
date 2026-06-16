/**
 * Tools de self-improvement (ADR 0023) — un juego **separado** de tools fs +
 * shell, scoped al **worktree aislado** (`../shiro-selfdev`), distinto del
 * agentic del usuario (scoped a `~/shiro-workspace`). Fronteras limpias: el
 * agentic del usuario no toca el repo de Shiro y viceversa.
 *
 * Diferencias con el agentic del usuario (ADR 0022):
 * - `fs:write`/`fs:delete` van tier **`auto`** (no `confirm`): dentro del
 *   worktree desechable las escrituras NO piden modal — las salvaguardas
 *   reales son eval-verde + review del PR (decisión: aprobación sesión + PR
 *   final, no por cada write).
 * - `fs:write`/`fs:delete` chequean la **denylist de inmutables** antes de
 *   tocar disco (carácter, ADRs, permisos, secrets). Ver `immutable-paths`.
 *
 * Node-only (`@proyecto-shiro/core/node`). En este PR (cimentación) las
 * factories quedan listas y exportadas pero **nadie las invoca todavía** —
 * el `SelfDevSession` que las usa llega en el PR 5.
 */

import { relative, resolve } from 'node:path';
import { z } from 'zod';
import type { ModuleDeps } from '../../../core/module-loader.js';
import type { IToolModule, ToolContext, ToolResult } from '../../../interfaces/IToolModule.js';
import type { IToolsRegistry } from '../../../interfaces/IToolsRegistry.js';
import { FsScope } from '../fs/fs-scope.js';
import { FsDeleteTool, FsListTool, FsReadTool, FsWriteTool } from '../fs/fs-tools.js';
import { ShellAllowlist, ShellExecTool } from '../shell/shell-tool.js';
import { ToolsRegistry } from '../tools-registry.js';
import { immutablePathError, isImmutable } from './immutable-paths.js';

// ─── Config ───────────────────────────────────────────────────────────

const SelfDevShellCommandSchema = z.object({
  cmd: z.string().min(1),
  allowed_args_pattern: z.string().min(1),
});

/**
 * Config del bloque top-level `selfdev:` de `modules.config.yaml`. Separada
 * del slot `tools` del usuario (decisión "config separada"). En `schemas.ts`
 * entra como un record opcional; aquí se valida en detalle (mismo patrón que
 * cada módulo valida su propia `config`).
 */
export const SelfDevConfigSchema = z.object({
  /** Worktree aislado (relativo a la raíz del repo) donde Shiro genera. */
  worktree_path: z.string().min(1).default('../shiro-selfdev'),
  /** Prefijo de rama de los PRs de Shiro (distinto de `feat/<user>/...`). */
  branch_prefix: z.string().min(1).default('shiro/'),
  /** Tope de bytes que `fs:read` devuelve en el worktree. */
  max_read_bytes: z.number().int().positive().default(262_144),
  /** Scripts npm que deben pasar (verdes) antes del PR — eval-runner (PR 3). */
  eval_commands: z.array(z.string().min(1)).default(['format:check', 'lint', 'typecheck', 'test']),
  /** Reintentos de corrección si el eval falla, antes de abortar (PR 5). */
  max_fix_iterations: z.number().int().nonnegative().default(2),
  /** Timeout por comando shell (ms) — builds/test tardan, generoso. */
  shell_timeout_ms: z.number().int().positive().default(120_000),
  /** Allowlist de comandos de los helpers del orquestador (PRs 2-4). */
  shell_commands: z.array(SelfDevShellCommandSchema).default([]),
});

export type SelfDevConfig = z.infer<typeof SelfDevConfigSchema>;

export class SelfDevConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfDevConfigError';
  }
}

/** Valida el bloque `selfdev:` de la config y aplica defaults. */
export function parseSelfDevConfig(raw: unknown): SelfDevConfig {
  const parsed = SelfDevConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new SelfDevConfigError(
      `config selfdev inválida — ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

// ─── Guard de inmutabilidad ───────────────────────────────────────────

const PathOnly = z.object({ path: z.string().min(1) });

/**
 * Envuelve una tool fs de escritura/borrado y la convierte a self-dev:
 * tier **`auto`** + chequeo de la **denylist de inmutables**. Si el `path`
 * cae en un archivo protegido, devuelve `IMMUTABLE_PATH` SIN tocar disco y
 * SIN delegar a la tool envuelta.
 */
export class SelfDevWriteGuard implements IToolModule {
  readonly permissionTier = 'auto' as const;

  constructor(
    private readonly inner: IToolModule,
    private readonly worktreeRoot: string,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  get name(): string {
    return this.inner.name;
  }

  get description(): string {
    return `${this.inner.description} (bloquea archivos protegidos de Shiro: carácter, ADRs, permisos)`;
  }

  get schema(): IToolModule['schema'] {
    return this.inner.schema;
  }

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = PathOnly.safeParse(args);
    if (parsed.success) {
      const repoRel = relative(this.worktreeRoot, resolve(this.worktreeRoot, parsed.data.path));
      if (isImmutable(repoRel)) {
        return { ok: false, output: '', error: immutablePathError(repoRel) };
      }
    }
    return this.inner.execute(args, ctx);
  }
}

// ─── Factories (las consume el SelfDevSession en el PR 5) ─────────────

/**
 * Construye un `IToolsRegistry` **separado** con las tools fs scoped al
 * worktree: `fs:read`/`fs:list` (`auto`) + `fs:write`/`fs:delete` (`auto` +
 * guard de inmutables). Es el juego de tools que el sub-loop de generación
 * (PR 5) le da al LLM — NO se mezcla con el registry agentic del usuario.
 */
export function createSelfDevFsRegistry(opts: {
  worktreeRoot: string;
  config: SelfDevConfig;
  deps: ModuleDeps;
}): IToolsRegistry {
  const { worktreeRoot, config, deps } = opts;
  const scope = new FsScope({ paths: [worktreeRoot], max_read_bytes: config.max_read_bytes });
  const registry = new ToolsRegistry({}, deps);
  registry.register(new FsReadTool(scope));
  registry.register(new FsListTool(scope));
  registry.register(new SelfDevWriteGuard(new FsWriteTool(scope), worktreeRoot));
  registry.register(new SelfDevWriteGuard(new FsDeleteTool(scope), worktreeRoot));
  deps.logger
    .child({ module: 'SelfDevTools' })
    .info(`tools fs de self-dev listas (worktree: ${worktreeRoot})`);
  return registry;
}

/**
 * `ShellExecTool` scoped al worktree con el allowlist git/gh/npm de la
 * config. Lo usan los helpers del orquestador (worktree manager, eval
 * runner, gh:pr-create — PRs 2-4) llamando `execute()` directamente, no el
 * LLM por el tool-loop.
 */
export function createSelfDevShell(opts: {
  worktreeRoot: string;
  config: SelfDevConfig;
}): ShellExecTool {
  const allowlist = new ShellAllowlist(opts.config.shell_commands);
  return new ShellExecTool(allowlist, opts.worktreeRoot, opts.config.shell_timeout_ms);
}
