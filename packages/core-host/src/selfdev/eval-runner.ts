/**
 * EvalRunner (ADR 0023 §6) — corre los checks de validación (`format:check`,
 * `lint`, `typecheck`, `test`) dentro del worktree de self-dev, en orden, y
 * **para en el primer fallo**. Es la barrera dura "no se abre PR si algo está
 * rojo": el `SelfDevSession` (PR posterior) usa el resultado para decidir si
 * propone el PR o reintenta la generación.
 *
 * Orden importa: los checks baratos (format/lint) van antes que los caros
 * (typecheck/test), así un fallo trivial corta rápido y el LLM lo arregla sin
 * esperar a la suite entera.
 *
 * El runner es agnóstico de cómo se ejecutan los comandos (`CommandRunner`
 * inyectable) — testeable sin spawnear npm. `createEvalRunner` arma el runner
 * real reusando el shell de self-dev (npm scoped al worktree).
 */

import type { Logger } from '@proyecto-shiro/core';
import { createSelfDevShell } from '@proyecto-shiro/core/node';
import type { SelfDevConfig } from '@proyecto-shiro/core/node';

export interface EvalResult {
  /** True solo si TODOS los comandos pasaron. */
  ok: boolean;
  /** Scripts que pasaron (en orden), hasta el fallo o todos. */
  passed: string[];
  /** Script que falló, si alguno. */
  failed?: string;
  /** Salida del comando que falló (para que el LLM la arregle), o resumen. */
  output: string;
}

/** Ejecuta `npm run <script>` y devuelve ok + salida. Inyectable para tests. */
export type CommandRunner = (script: string) => Promise<{ ok: boolean; output: string }>;

export class EvalRunner {
  /** Scripts a correr, en orden. Expuesto para inspección/tests. */
  readonly commands: readonly string[];
  private readonly runCommand: CommandRunner;
  private readonly logger: Logger;

  constructor(opts: { commands: readonly string[]; run: CommandRunner; logger: Logger }) {
    this.commands = opts.commands;
    this.runCommand = opts.run;
    this.logger = opts.logger;
  }

  /**
   * Corre los comandos en orden; para en el primero que falle. Nunca lanza:
   * un comando fallido se reporta con `ok: false` + su salida.
   */
  async run(): Promise<EvalResult> {
    const passed: string[] = [];
    for (const script of this.commands) {
      this.logger.info(`eval: npm run ${script}…`);
      const r = await this.runCommand(script);
      if (!r.ok) {
        this.logger.warn(`eval: '${script}' falló — se detiene el gate`);
        return { ok: false, failed: script, output: r.output, passed };
      }
      passed.push(script);
    }
    this.logger.info(`eval: ${String(passed.length)} checks verdes`);
    return {
      ok: true,
      passed,
      output: passed.length > 0 ? `OK: ${passed.join(', ')}` : '(sin checks)',
    };
  }
}

/**
 * Arma un `EvalRunner` real: corre `npm run <script>` dentro del worktree vía
 * el `ShellExecTool` de self-dev (allowlist + spawn sin shell + timeout). El
 * allowlist de la config debe permitir `npm run`.
 */
export function createEvalRunner(opts: {
  worktreePath: string;
  config: SelfDevConfig;
  logger: Logger;
}): EvalRunner {
  const logger = opts.logger.child({ module: 'EvalRunner' });
  const shell = createSelfDevShell({ worktreeRoot: opts.worktreePath, config: opts.config });
  const run: CommandRunner = async (script) => {
    const r = await shell.execute(
      { command: 'npm', args: ['run', script] },
      { logger, userId: 'selfdev' },
    );
    return { ok: r.ok, output: r.output };
  };
  return new EvalRunner({ commands: opts.config.eval_commands, run, logger });
}
