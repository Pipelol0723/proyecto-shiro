/**
 * `wireSelfDev` (ADR 0023) — cablea el flujo de self-improvement en el bootstrap.
 *
 * Responsabilidades:
 *   1. **Auto-detección dev-only**: self-dev requiere el repo clonado + `git` +
 *      `gh` en el PATH. En el binario instalado (cwd = data dir, sin repo) queda
 *      apagado. Se detecta con `git rev-parse --show-toplevel` + `gh --version`.
 *   2. **Wiring de los `SelfDevSteps` reales** (git/npm/gh/LLM) que el
 *      `SelfDevSession` orquesta.
 *   3. **Registro del trigger** `selfdev:propose` en el registry agéntico del
 *      usuario, con guardia de concurrencia (una sesión a la vez — el worktree
 *      es único).
 *
 * Node-only (`@proyecto-shiro/core-host`).
 */

import { resolve } from 'node:path';
import {
  createGhPrCreateTool,
  createSelfDevFsRegistry,
  createSelfDevShell,
  createWorktreeManager,
  parseSelfDevConfig,
  ShellAllowlist,
  ShellExecTool,
  type SelfDevConfig,
} from '@proyecto-shiro/core/node';
import type {
  EventMap,
  IEventBus,
  ILLMModule,
  LoadedModules,
  Logger,
  ModuleDeps,
  ModulesConfig,
  ToolContext,
} from '@proyecto-shiro/core';
import { buildToolDefs, makeToolExecutor } from '../pipeline/tool-loop.js';
import type { ApprovalGate } from '../pipeline/approval-gate.js';
import { createEvalRunner } from './eval-runner.js';
import { linkNodeModules } from './node-modules-link.js';
import { registerSelfDevTrigger } from './selfdev-trigger.js';
import { SelfDevSession, type GenerateRound, type SelfDevSteps } from './selfdev-session.js';

type Emotion = EventMap['llm:responded']['emotion'];

export interface WireSelfDevOptions {
  bus: IEventBus<EventMap>;
  modules: LoadedModules;
  config: ModulesConfig;
  logger: Logger;
  /** Usuario dueño de los eventos/reporte (single-user por ahora). */
  userId: string;
  /** Gate de aprobación para el PR final (dedicado; el bootstrap lo dispone). */
  approvalGate: ApprovalGate;
  /** Reporte hablado: emite `llm:responded` + TTS. Lo provee el bootstrap. */
  announce: (text: string, emotion: Emotion) => void | Promise<void>;
  /**
   * Detector de entorno. Default: chequea repo git + `gh` reales. Se inyecta
   * en tests para no depender de git/gh de la máquina.
   */
  detectEnv?: (logger: Logger) => Promise<SelfDevEnv>;
}

export interface WireSelfDevResult {
  /** True si self-dev quedó habilitado (entorno dev con repo + git/gh). */
  enabled: boolean;
  dispose: () => void;
}

// ─── Prompts del sub-loop de generación ───────────────────────────────

function buildSelfDevSystemPrompt(worktreePath: string): string {
  return [
    `Sos Shiro trabajando como ingeniera sobre tu propio código, en un worktree git AISLADO en ${worktreePath}.`,
    'Reglas:',
    '- Hacé UN cambio enfocado y mínimo que resuelva la tarea. No refactorices de más.',
    '- Explorá con fs:list / fs:read antes de escribir. Aplicá cambios con fs:write / fs:delete.',
    '- Las rutas son relativas a la raíz del repo (p.ej. `packages/core/src/...`).',
    '- Hay archivos INMUTABLES (carácter, ADRs, config, permisos, .env). Si fs:write devuelve',
    '  IMMUTABLE_PATH, NO insistas: dejá ese archivo como está.',
    '- Respetá el estilo existente (TypeScript strict, ESM, sin `any`, comentarios en español).',
    '- No corras git ni abras PRs vos — de eso se encarga el orquestador.',
    'Cuando termines, respondé con un resumen claro (2-4 frases) de QUÉ cambiaste y POR QUÉ.',
    'Ese resumen va al cuerpo del PR.',
  ].join('\n');
}

function buildTaskPrompt(round: GenerateRound): string {
  const lines = [`Tarea: ${round.topic}`];
  if (round.summary !== undefined && round.summary.length > 0) {
    lines.push(`Detalle: ${round.summary}`);
  }
  if (round.feedback !== undefined && round.feedback.length > 0) {
    lines.push(
      '',
      'El intento anterior NO pasó el eval. Corregí exactamente esto:',
      round.feedback,
    );
  } else {
    lines.push('', 'Explorá el código relevante y aplicá el cambio.');
  }
  return lines.join('\n');
}

// ─── Steps reales ─────────────────────────────────────────────────────

/**
 * Construye los `SelfDevSteps` reales (git/npm/gh/LLM) a partir del entorno.
 * Separado de `wireSelfDev` para poder testear la orquestación con el session
 * real + fakes de git en integración.
 */
export function createSelfDevSteps(opts: {
  repoRoot: string;
  config: SelfDevConfig;
  deps: ModuleDeps;
  llm: ILLMModule;
  approvalGate: ApprovalGate;
  userId: string;
}): SelfDevSteps {
  const { repoRoot, config, deps, llm, approvalGate, userId } = opts;
  const logger = deps.logger.child({ module: 'SelfDevSteps' });
  const worktreePath = resolve(repoRoot, config.worktree_path);
  const ctx: ToolContext = { logger, userId };

  const worktreeManager = createWorktreeManager({ repoRoot, config, deps });
  const repoShell = createSelfDevShell({ worktreeRoot: repoRoot, config });
  const worktreeShell = createSelfDevShell({ worktreeRoot: worktreePath, config });
  const fsRegistry = createSelfDevFsRegistry({ worktreeRoot: worktreePath, config, deps });
  const evalRunner = createEvalRunner({ worktreePath, config, logger });
  const ghPrTool = createGhPrCreateTool({ worktreeRoot: worktreePath, logger });

  /** Primer ref existente de la lista (para basar el worktree en lo más nuevo). */
  const resolveBase = async (): Promise<string> => {
    for (const ref of ['origin/develop', 'develop', 'HEAD']) {
      const r = await repoShell.execute(
        { command: 'git', args: ['rev-parse', '--verify', '--quiet', ref] },
        ctx,
      );
      if (r.ok) return ref;
    }
    return 'HEAD';
  };

  const gitWorktree = (args: string[]): Promise<{ ok: boolean; output: string; error?: string }> =>
    worktreeShell.execute({ command: 'git', args }, ctx);

  return {
    async setup(topic) {
      // Base en lo más nuevo: fetch best-effort (si no hay red, seguimos con lo local).
      const fetched = await repoShell.execute(
        { command: 'git', args: ['fetch', 'origin', 'develop'] },
        ctx,
      );
      if (!fetched.ok)
        logger.warn('git fetch origin develop falló — uso la base local', {
          output: fetched.output,
        });
      // Base limpia: quita cualquier worktree previo (una sesión fallida lo deja).
      await worktreeManager.remove();
      const base = await resolveBase();
      const wt = await worktreeManager.ensure(topic, base);
      if (!wt.ok) return { ok: false, branch: wt.branch, error: wt.error };
      try {
        await linkNodeModules(repoRoot, worktreePath);
      } catch (err) {
        return {
          ok: false,
          branch: wt.branch,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      return { ok: true, branch: wt.branch };
    },

    async generate(round) {
      const executeTool = makeToolExecutor(fsRegistry, ctx, logger, approvalGate);
      try {
        const resp = await llm.generateWithTools!(
          {
            text: buildTaskPrompt(round),
            systemPrompt: buildSelfDevSystemPrompt(worktreePath),
            userId,
          },
          { tools: buildToolDefs(fsRegistry), executeTool },
        );
        return { ok: true, summary: resp.text };
      } catch (err) {
        return { ok: false, summary: '', error: err instanceof Error ? err.message : String(err) };
      }
    },

    async verify() {
      // Reconstruye SOLO core: es el único paquete cuyo `dist` consumen los
      // demás (core-host/desktop se validan desde su `src`). Rápido y suficiente.
      const build = await worktreeShell.execute(
        { command: 'npm', args: ['run', 'build', '-w', '@proyecto-shiro/core'] },
        ctx,
      );
      if (!build.ok) {
        return {
          ok: false,
          output: build.output || (build.error ?? 'build falló'),
          failed: 'build',
        };
      }
      const evalResult = await evalRunner.run();
      return {
        ok: evalResult.ok,
        output: evalResult.output,
        ...(evalResult.failed !== undefined ? { failed: evalResult.failed } : {}),
      };
    },

    async diff() {
      const r = await gitWorktree(['diff', 'origin/develop', '--stat']);
      return r.ok ? r.output : '';
    },

    async commitAndPush(branch, message) {
      const add = await gitWorktree(['add', '-A']);
      if (!add.ok) return { ok: false, output: add.output || (add.error ?? 'git add falló') };
      const commit = await gitWorktree(['commit', '-m', message]);
      if (!commit.ok)
        return { ok: false, output: commit.output || (commit.error ?? 'git commit falló') };
      const push = await gitWorktree(['push', '-u', 'origin', branch]);
      if (!push.ok) return { ok: false, output: push.output || (push.error ?? 'git push falló') };
      return { ok: true, output: 'pushed' };
    },

    requestPrApproval(preview) {
      return approvalGate.requestApproval({
        toolId: 'gh:pr-create',
        toolName: 'gh_pr_create',
        argsPreview: preview,
        userId,
      });
    },

    async createPr(title, body) {
      const r = await ghPrTool.execute({ title, body, base: 'develop' }, ctx);
      if (!r.ok) return { ok: false, error: r.error ?? 'gh pr create falló' };
      const url = (r.data as { url?: string } | undefined)?.url ?? r.output;
      return { ok: true, url };
    },

    async cleanup() {
      await worktreeManager.remove();
    },
  };
}

// ─── Detección de entorno ─────────────────────────────────────────────

export interface SelfDevEnv {
  available: boolean;
  repoRoot: string;
  reason?: string;
}

/**
 * Detecta si el entorno soporta self-dev: hay un repo git (cwd dentro de él) y
 * `gh` instalado. Usa el `ShellExecTool` (spawn sin shell, cross-platform) con
 * un allowlist propio y acotado.
 */
async function detectSelfDevEnv(logger: Logger): Promise<SelfDevEnv> {
  const ctx: ToolContext = { logger, userId: 'selfdev' };
  const shell = new ShellExecTool(
    new ShellAllowlist([
      { cmd: 'git', allowed_args_pattern: '^rev-parse --show-toplevel$' },
      { cmd: 'gh', allowed_args_pattern: '^--version$' },
    ]),
    process.cwd(),
    10_000,
  );
  const git = await shell.execute({ command: 'git', args: ['rev-parse', '--show-toplevel'] }, ctx);
  if (!git.ok) {
    return { available: false, repoRoot: '', reason: 'no es un repo git (o git no está en PATH)' };
  }
  const repoRoot = resolve((git.output.trim().split(/\r?\n/)[0] ?? '').trim());
  const gh = await shell.execute({ command: 'gh', args: ['--version'] }, ctx);
  if (!gh.ok) {
    return {
      available: false,
      repoRoot,
      reason: 'gh (GitHub CLI) no está instalado o no está en PATH',
    };
  }
  return { available: true, repoRoot };
}

// ─── Wiring ───────────────────────────────────────────────────────────

/**
 * Cablea self-dev si el entorno lo soporta. Idempotente respecto al registry
 * (registra la tool una vez). Devuelve `enabled` + `dispose`.
 */
export async function wireSelfDev(opts: WireSelfDevOptions): Promise<WireSelfDevResult> {
  const { bus, modules, config, logger, userId, approvalGate, announce } = opts;
  const log = logger.child({ module: 'SelfDev' });
  const noop: WireSelfDevResult = { enabled: false, dispose: () => undefined };

  const detect = opts.detectEnv ?? detectSelfDevEnv;
  const env = await detect(log);
  if (!env.available) {
    log.info(`self-dev no disponible: ${env.reason ?? 'entorno no apto'}`);
    return noop;
  }

  // El slot cloud debe soportar tool-use (self-dev necesita el loop; el local no).
  const llm: ILLMModule = modules.llmCloud;
  if (typeof llm.generateWithTools !== 'function') {
    log.warn('self-dev no disponible: el LLM cloud no soporta tool-use (generateWithTools)');
    return noop;
  }

  let sdConfig: SelfDevConfig;
  try {
    sdConfig = parseSelfDevConfig(config.selfdev);
  } catch (err) {
    log.warn('config selfdev inválida — self-dev deshabilitado', { err });
    return noop;
  }

  const deps: ModuleDeps = { logger, bus };
  const steps = createSelfDevSteps({
    repoRoot: env.repoRoot,
    config: sdConfig,
    deps,
    llm,
    approvalGate,
    userId,
  });
  const session = new SelfDevSession({
    bus,
    logger,
    maxFixIterations: sdConfig.max_fix_iterations,
    steps,
    announce,
  });

  registerSelfDevTrigger(modules.tools, {
    logger,
    onPropose: (topic, summary) => {
      if (session.isRunning()) {
        return {
          accepted: false,
          reason: 'ya hay una sesión de self-dev en curso; esperá a que termine',
        };
      }
      void session.run(topic, summary);
      return { accepted: true };
    },
  });

  log.info(`self-dev habilitado (repo: ${env.repoRoot}, worktree: ${sdConfig.worktree_path})`);
  // El trigger vive en el registry (se desarma con el orchestrator). No hay
  // timers propios que limpiar; el gate lo dispone el bootstrap.
  return { enabled: true, dispose: () => undefined };
}
