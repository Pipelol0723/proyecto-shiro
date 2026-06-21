/**
 * Tool `gh:pr-create` (ADR 0023 §1) — abre un Pull Request en GitHub desde la
 * rama actual del worktree de self-dev. Es el **gate final** del flujo: tier
 * `confirm`, así que el modal de aprobación (ADR 0022 §4) lo muestra al usuario
 * con el diff antes de exponer el trabajo al mundo.
 *
 * **Frontera dura**: el allowlist del shell interno está **hardcodeado** a
 * `^pr create` — esta tool SOLO puede `gh pr create`. No puede `gh pr merge`
 * (el humano mergea, ADR 0023 §1), ni `gh release`, ni nada más. Y como el
 * subcomando (`pr create`) lo fija el código (no el LLM, que solo aporta
 * title/body/base), no hay forma de que el modelo lo desvíe.
 *
 * Asume que la rama YA está pusheada (el `SelfDevSession` hace el `git push`
 * antes de invocar esta tool). Node-only (`@proyecto-shiro/core/node`).
 */

import { z } from 'zod';
import { Logger } from '../../../core/logger.js';
import type { IToolModule, ToolContext, ToolResult } from '../../../interfaces/IToolModule.js';
import { ShellAllowlist, ShellExecTool } from '../shell/shell-tool.js';

/** Ejecuta `gh <args>` en el worktree. Inyectable para tests. */
export type GhExec = (args: string[]) => Promise<{ ok: boolean; output: string; error?: string }>;

const GhPrCreateArgs = z.object({
  /** Título del PR. */
  title: z.string().min(1),
  /** Cuerpo del PR (markdown). */
  body: z.string().default(''),
  /** Rama base del PR. Default `develop` (convención del repo). */
  base: z.string().min(1).default('develop'),
});

function invalidArgs(error: z.ZodError): ToolResult {
  return {
    ok: false,
    output: '',
    error: `args inválidos: ${error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
  };
}

export class GhPrCreateTool implements IToolModule {
  readonly id = 'gh:pr-create';
  readonly name = 'gh_pr_create';
  readonly description =
    'Abre un Pull Request en GitHub (gh pr create) desde la rama actual hacia `base` (default develop). ' +
    'Pide confirmación. NO mergea ni publica releases — solo crea el PR para que el humano lo revise.';
  readonly schema = GhPrCreateArgs;
  readonly permissionTier = 'confirm' as const;

  constructor(private readonly ghExec: GhExec) {}

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) return invalidArgs(parsed.error);
    const { title, body, base } = parsed.data;
    // Subcomando FIJO: `pr create`. El LLM solo aporta title/body/base.
    const r = await this.ghExec(['pr', 'create', '--base', base, '--title', title, '--body', body]);
    if (!r.ok) return { ok: false, output: '', error: r.error ?? r.output };
    const url = /https?:\/\/\S+/.exec(r.output)?.[0] ?? r.output.trim();
    return { ok: true, output: url, data: { url, base, title } };
  }
}

/**
 * Construye el `GhPrCreateTool` con un `GhExec` real: un `ShellExecTool` con un
 * allowlist **hardcodeado** a `gh pr create`, scoped al worktree. El allowlist
 * NO sale de config (es una salvaguarda inmutable, como la denylist de paths).
 */
export function createGhPrCreateTool(opts: {
  worktreeRoot: string;
  logger?: Logger;
  timeoutMs?: number;
}): GhPrCreateTool {
  const logger = (opts.logger ?? new Logger('info')).child({ module: 'GhPrCreate' });
  const allowlist = new ShellAllowlist([{ cmd: 'gh', allowed_args_pattern: '^pr create\\b' }]);
  const shell = new ShellExecTool(allowlist, opts.worktreeRoot, opts.timeoutMs ?? 120_000);
  const ghExec: GhExec = async (args) => {
    const r = await shell.execute({ command: 'gh', args }, { logger, userId: 'selfdev' });
    return { ok: r.ok, output: r.output, error: r.error };
  };
  return new GhPrCreateTool(ghExec);
}
