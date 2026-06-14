/**
 * Tool `shell:exec` (ADR 0022 §3): ejecuta un comando de un **allowlist**
 * configurado, con sus argumentos, dentro de un `cwd` acotado.
 *
 * Modelo de seguridad (capas):
 * 1. **Allowlist por comando**: solo los `cmd` declarados en
 *    `tools.config.shell.commands` se pueden ejecutar.
 * 2. **Patrón de args por comando**: los argumentos (unidos por espacio)
 *    deben casar el regex `allowed_args_pattern` de ese comando. Bloquea
 *    clases enteras de error tipo "Shiro corrió `git push --force`".
 * 3. **Spawn directo, SIN shell** (`shell: false`): los args van como argv
 *    separados, NO interpolados en una shell → cero inyección (`; rm -rf`
 *    es un argumento literal, no un comando nuevo).
 * 4. **cwd acotado** (sandbox por defecto) + **timeout** (mata procesos
 *    colgados) + **tope de salida**.
 *
 * Tier `confirm`: el modal de aprobación (PR #5) lo gatea. Node-only —
 * vive en `@proyecto-shiro/core/node` (ADR 0011). Dormida hasta el loop
 * tool-use (PR #4).
 */

import { spawn } from 'node:child_process';
import { promises as fs, constants as fsConstants } from 'node:fs';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { ModuleDeps } from '../../../core/module-loader.js';
import type { IToolModule, ToolContext, ToolResult } from '../../../interfaces/IToolModule.js';
import type { IToolsRegistry } from '../../../interfaces/IToolsRegistry.js';
import { expandTilde } from '../fs/fs-scope.js';

export class ShellToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellToolError';
  }
}

// ─── Schema de config ─────────────────────────────────────────────────

const AllowedCommandSchema = z.object({
  /** Nombre del ejecutable permitido (p.ej. `git`, `npm`, `gh`). */
  cmd: z.string().min(1),
  /**
   * Regex que los argumentos (unidos por espacio) deben casar. P.ej.
   * `^(status|log|diff)` permite solo subcomandos de lectura de git.
   */
  allowed_args_pattern: z
    .string()
    .min(1)
    .refine(
      (p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'patrón de regex inválido' },
    ),
});

export const ShellToolConfigSchema = z.object({
  commands: z.array(AllowedCommandSchema).default([]),
  /** Directorio de trabajo de los comandos. `~` = home. Default sandbox. */
  cwd: z.string().min(1).default('~/shiro-workspace'),
  /** Timeout por comando (ms). Mata el proceso si se cuelga. Default 30s. */
  timeout_ms: z.number().int().positive().default(30_000),
});

export type ShellToolConfig = z.infer<typeof ShellToolConfigSchema>;

// ─── Allowlist ────────────────────────────────────────────────────────

export type AllowCheck = { ok: true } | { ok: false; error: string };

export class ShellAllowlist {
  private readonly commands: Map<string, RegExp>;

  constructor(entries: readonly { cmd: string; allowed_args_pattern: string }[]) {
    this.commands = new Map(entries.map((e) => [e.cmd, new RegExp(e.allowed_args_pattern)]));
  }

  check(cmd: string, argsStr: string): AllowCheck {
    const pattern = this.commands.get(cmd);
    if (pattern === undefined) {
      return { ok: false, error: `comando no permitido: '${cmd}' (no está en el allowlist)` };
    }
    if (!pattern.test(argsStr)) {
      return { ok: false, error: `argumentos no permitidos para '${cmd}': '${argsStr}'` };
    }
    return { ok: true };
  }

  list(): string[] {
    return Array.from(this.commands.keys());
  }
}

// ─── Resolución de comando (cross-platform, sin shell) ────────────────

/**
 * Resuelve `cmd` a una ruta absoluta de ejecutable buscando en `PATH`
 * (y aplicando `PATHEXT` en Windows). Devuelve `null` si no se encuentra.
 * Necesario porque `spawn(cmd, args, { shell:false })` no resuelve por sí
 * mismo el nombre en Windows.
 */
async function resolveCommand(cmd: string): Promise<string | null> {
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  async function executable(candidate: string): Promise<string | null> {
    const variants =
      isWin && extname(candidate) === '' ? exts.map((e) => candidate + e) : [candidate];
    for (const v of variants) {
      try {
        await fs.access(v, fsConstants.X_OK);
        return v;
      } catch {
        // sigue probando
      }
    }
    return null;
  }

  if (isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    return executable(resolve(cmd));
  }
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const found = await executable(join(dir, cmd));
    if (found !== null) return found;
  }
  return null;
}

// ─── Ejecución ────────────────────────────────────────────────────────

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; maxOutputBytes: number },
): Promise<RunResult> {
  return new Promise<RunResult>((res) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (cur: string, chunk: string): string =>
      cur.length >= opts.maxOutputBytes ? cur : (cur + chunk).slice(0, opts.maxOutputBytes);
    child.stdout?.on('data', (d: Buffer) => {
      stdout = cap(stdout, d.toString('utf8'));
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr = cap(stderr, d.toString('utf8'));
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      res({ code: null, stdout, stderr, timedOut, spawnError: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr, timedOut });
    });
  });
}

// ─── Tool ─────────────────────────────────────────────────────────────

const ShellArgs = z.object({
  /** Ejecutable a correr (debe estar en el allowlist). */
  command: z.string().min(1),
  /** Argumentos como array (van como argv separados, sin shell). */
  args: z.array(z.string()).default([]),
});

function invalidArgs(error: z.ZodError): ToolResult {
  return {
    ok: false,
    output: '',
    error: `args inválidos: ${error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`,
  };
}

function fail(error: string): ToolResult {
  return { ok: false, output: '', error };
}

export class ShellExecTool implements IToolModule {
  readonly id = 'shell:exec';
  readonly name = 'shell_exec';
  readonly description: string;
  readonly schema = ShellArgs;
  readonly permissionTier = 'confirm' as const;
  private readonly maxOutputBytes = 64 * 1024;

  constructor(
    private readonly allowlist: ShellAllowlist,
    private readonly cwd: string,
    private readonly timeoutMs: number,
  ) {
    const cmds = allowlist.list();
    this.description =
      'Ejecuta uno de los comandos permitidos, con sus argumentos, en el workspace de Shiro. ' +
      `Comandos disponibles: ${cmds.length > 0 ? cmds.join(', ') : 'ninguno configurado'}. ` +
      'Pide confirmación antes de ejecutar.';
  }

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) return invalidArgs(parsed.error);
    const { command, args: cmdArgs } = parsed.data;

    const check = this.allowlist.check(command, cmdArgs.join(' '));
    if (!check.ok) return fail(check.error);

    const resolved = await resolveCommand(command);
    if (resolved === null) return fail(`comando no encontrado en PATH: ${command}`);

    const r = await runCommand(resolved, cmdArgs, {
      cwd: this.cwd,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    });
    if (r.spawnError !== undefined) return fail(`error al ejecutar: ${r.spawnError}`);
    if (r.timedOut) return fail(`timeout (${String(this.timeoutMs)} ms) ejecutando: ${command}`);

    const parts = [
      r.stdout.trim(),
      r.stderr.trim() ? `--- stderr ---\n${r.stderr.trim()}` : '',
    ].filter(Boolean);
    const output = parts.join('\n') || '(sin salida)';
    return {
      ok: r.code === 0,
      output,
      data: { exitCode: r.code, command, args: cmdArgs },
      error: r.code === 0 ? undefined : `el comando terminó con código ${String(r.code)}`,
    };
  }
}

// ─── Registro ─────────────────────────────────────────────────────────

/**
 * Construye el allowlist desde la config (`tools.config.shell`) y registra
 * `shell:exec` en el registry. Lo llama el bootstrap del core-host tras
 * `orchestrator.init()`. Asegura el `cwd` best-effort.
 */
export function registerShellTool(
  registry: IToolsRegistry,
  rawConfig: unknown,
  deps: ModuleDeps,
): void {
  const logger = deps.logger.child({ module: 'ShellTool' });
  const parsed = ShellToolConfigSchema.safeParse(rawConfig ?? {});
  if (!parsed.success) {
    throw new ShellToolError(
      `config shell inválida — ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const cwd = resolve(expandTilde(parsed.data.cwd));
  void fs.mkdir(cwd, { recursive: true }).catch(() => undefined);
  const allowlist = new ShellAllowlist(parsed.data.commands);
  registry.register(new ShellExecTool(allowlist, cwd, parsed.data.timeout_ms));
  logger.info(
    `tool shell:exec registrada (cmds: ${allowlist.list().join(', ') || '<vacío>'}, cwd: ${cwd}, timeout: ${String(parsed.data.timeout_ms)}ms)`,
  );
}
