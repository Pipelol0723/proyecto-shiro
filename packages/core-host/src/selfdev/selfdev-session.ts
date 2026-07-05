/**
 * `SelfDevSession` (ADR 0023) — el **orquestador** del flujo de self-improvement.
 * Dirige la secuencia determinista y delega el razonamiento de código a la LLM
 * cloud en un sub-loop acotado. Es propose-only: nunca mergea ni pushea a
 * develop/main (ver no-goals del ADR).
 *
 * Flujo de `run(topic)`:
 *   1. setup    — fetch base + (re)crear worktree aislado + enlazar node_modules.
 *   2. generate — sub-loop tool-use: la LLM lee/escribe en el worktree.
 *   3. verify   — build core + eval (format/lint/typecheck/test). Si falla,
 *                 realimenta la salida y reintenta generate (máx `maxFixIterations`).
 *   4. commit   — add -A + commit + push a `shiro/<topic>` (solo si eval verde).
 *   5. PR gate  — modal de aprobación con el diff; al aprobar, `gh pr create`.
 *   6. cleanup  — quita el worktree (solo en éxito; en fallo lo deja para inspección).
 *
 * Los pasos con efectos (git, LLM, gh, aprobación) se inyectan como
 * {@link SelfDevSteps} para que la **orquestación** (secuencia, fix-loop, gates)
 * sea testeable con fakes. El wiring real lo arma `wireSelfDev`. Node-only.
 */

import { randomUUID } from 'node:crypto';
import type { EventMap, IEventBus, Logger } from '@proyecto-shiro/core';

/** Emoción para el reporte hablado (subconjunto del enum del personaje). */
type Emotion = EventMap['llm:responded']['emotion'];

/** Una ronda de generación. `feedback` = salida del eval del intento anterior. */
export interface GenerateRound {
  topic: string;
  summary?: string;
  feedback?: string;
}

export interface GenerateOutcome {
  ok: boolean;
  /** Resumen en texto de lo que la LLM cambió (su respuesta final). */
  summary: string;
  error?: string;
}

export interface VerifyOutcome {
  ok: boolean;
  /** Salida agregada (build/eval) — feedback para el fix-loop + logging. */
  output: string;
  /** Nombre del check que falló (para el evento de progreso). */
  failed?: string;
}

export interface SetupOutcome {
  ok: boolean;
  /** Rama `shiro/<topic>` del worktree. */
  branch: string;
  error?: string;
}

export interface CommitOutcome {
  ok: boolean;
  output: string;
}

export interface CreatePrOutcome {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Pasos con efectos que el orquestador invoca. Cada uno es inyectable: los
 * fakes de test ejercitan la orquestación sin git/LLM/gh reales.
 */
export interface SelfDevSteps {
  /** fetch de la base + (re)crea el worktree + enlaza node_modules. */
  setup(topic: string): Promise<SetupOutcome>;
  /** Una ronda de generación (tool-loop con las fs tools del worktree). */
  generate(round: GenerateRound): Promise<GenerateOutcome>;
  /** build de core + eval (format/lint/typecheck/test). */
  verify(): Promise<VerifyOutcome>;
  /** `git diff origin/develop --stat` (preview del modal + cuerpo del PR). */
  diff(): Promise<string>;
  /** add -A + commit + push a `shiro/<topic>`. */
  commitAndPush(branch: string, message: string): Promise<CommitOutcome>;
  /** Pide aprobación humana del PR con el preview del diff. */
  requestPrApproval(preview: string): Promise<boolean>;
  /** `gh pr create`. */
  createPr(title: string, body: string): Promise<CreatePrOutcome>;
  /** `git worktree remove` — SOLO en éxito (en fallo se deja para inspección). */
  cleanup(): Promise<void>;
}

export interface SelfDevSessionOptions {
  bus: IEventBus<EventMap>;
  logger: Logger;
  /** Reintentos de corrección si el eval falla, antes de abortar (config). */
  maxFixIterations: number;
  steps: SelfDevSteps;
  /** Reporte hablado: emite `llm:responded` + TTS. Lo provee el bootstrap. */
  announce: (text: string, emotion: Emotion) => void | Promise<void>;
}

/** Trunca para no inflar previews/eventos. */
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function buildCommitMessage(topic: string): string {
  return `feat(selfdev): ${truncate(topic, 68)}`;
}

function buildPrTitle(topic: string): string {
  return `feat(selfdev): ${truncate(topic, 68)}`;
}

function buildApprovalPreview(topic: string, diffStat: string): string {
  const stat = diffStat.trim() || '(sin cambios listados)';
  return `Abrir PR sobre "${topic}". Cambios (git diff --stat):\n${truncate(stat, 1500)}`;
}

function buildPrBody(topic: string, summary: string, diffStat: string): string {
  return [
    '## Qué',
    '',
    summary.trim() || `Cambios propuestos sobre: "${topic}".`,
    '',
    '## Por qué',
    '',
    `Propuesto por Shiro (self-improvement, ADR 0023) a partir de: "${topic}".`,
    '',
    '## Cambios',
    '',
    '```',
    truncate(diffStat.trim(), 3000) || '(diff no disponible)',
    '```',
    '',
    '## Checklist',
    '',
    '- [x] Pasa el eval local (format:check, lint, typecheck, test)',
    '- [ ] Revisado por un humano antes de mergear',
    '',
    '---',
    '🤖 Generado por Shiro en un worktree aislado. **No lo mergeó ella** — requiere tu revisión y merge.',
  ].join('\n');
}

export class SelfDevSession {
  private readonly bus: IEventBus<EventMap>;
  private readonly logger: Logger;
  private readonly maxFixIterations: number;
  private readonly steps: SelfDevSteps;
  private readonly announce: (text: string, emotion: Emotion) => void | Promise<void>;
  private running = false;

  constructor(opts: SelfDevSessionOptions) {
    this.bus = opts.bus;
    this.logger = opts.logger;
    this.maxFixIterations = opts.maxFixIterations;
    this.steps = opts.steps;
    this.announce = opts.announce;
  }

  /** True mientras hay una sesión en curso (el trigger lo consulta). */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Corre la sesión completa. Nunca lanza: los fallos esperables terminan en
   * `selfdev:done {ok:false}` + reporte hablado, y dejan el worktree para
   * inspección. Fire-and-forget desde el trigger.
   */
  async run(topic: string, summary?: string): Promise<void> {
    if (this.running) {
      this.logger.warn('run() ignorado — ya hay una sesión self-dev en curso');
      return;
    }
    this.running = true;
    const sessionId = randomUUID();
    const log = this.logger.child({ module: 'SelfDevSession', sessionId });

    const emitProgress = (phase: EventMap['selfdev:progress']['phase'], message?: string): void => {
      void this.bus.emit('selfdev:progress', {
        sessionId,
        topic,
        phase,
        ...(message !== undefined ? { message } : {}),
      });
    };

    try {
      log.info(`arranca sesión self-dev: "${topic}"`);

      // 1. Setup del worktree aislado.
      emitProgress('setup');
      const setup = await this.steps.setup(topic);
      if (!setup.ok) {
        await this.fail(
          sessionId,
          topic,
          undefined,
          `No pude preparar el worktree: ${setup.error ?? 'error desconocido'}`,
          log,
        );
        return;
      }
      const { branch } = setup;

      // 2-3. Generación + eval con fix-loop acotado.
      let feedback: string | undefined;
      let genSummary = '';
      let attempt = 0;
      for (;;) {
        emitProgress(
          attempt === 0 ? 'generating' : 'fixing',
          attempt === 0 ? undefined : `intento de corrección ${String(attempt)}`,
        );
        const gen = await this.steps.generate({ topic, summary, feedback });
        if (!gen.ok) {
          await this.fail(
            sessionId,
            topic,
            branch,
            `Falló la generación: ${gen.error ?? 'error desconocido'}`,
            log,
          );
          return;
        }
        genSummary = gen.summary;

        emitProgress('eval');
        const verify = await this.steps.verify();
        if (verify.ok) break;
        feedback = verify.output;
        log.warn(`eval rojo (${verify.failed ?? 'checks'}) en intento ${String(attempt)}`);
        if (attempt >= this.maxFixIterations) {
          await this.fail(
            sessionId,
            topic,
            branch,
            `El eval no pasó tras ${String(this.maxFixIterations)} reintentos (${verify.failed ?? 'checks'} en rojo). Dejé la rama ${branch} en el worktree por si querés mirarla.`,
            log,
          );
          return;
        }
        attempt++;
      }

      // ¿Hubo cambios reales? (la LLM pudo no tocar nada.)
      const diffStat = await this.steps.diff();
      if (diffStat.trim().length === 0) {
        await this.fail(sessionId, topic, branch, 'Terminé sin cambios que proponer.', log);
        return;
      }

      // 4. Commit + push.
      const cp = await this.steps.commitAndPush(branch, buildCommitMessage(topic));
      if (!cp.ok) {
        await this.fail(
          sessionId,
          topic,
          branch,
          `No pude commitear/pushear: ${truncate(cp.output, 300)}`,
          log,
        );
        return;
      }

      // 5. Gate de aprobación del PR.
      emitProgress('pr');
      const approved = await this.steps.requestPrApproval(buildApprovalPreview(topic, diffStat));
      if (!approved) {
        await this.fail(
          sessionId,
          topic,
          branch,
          `No aprobaste el PR. Dejé la rama ${branch} pusheada por si la querés revisar o abrir el PR a mano.`,
          log,
        );
        return;
      }
      const pr = await this.steps.createPr(
        buildPrTitle(topic),
        buildPrBody(topic, genSummary, diffStat),
      );
      if (!pr.ok) {
        await this.fail(
          sessionId,
          topic,
          branch,
          `gh pr create falló: ${pr.error ?? 'error desconocido'}. La rama ${branch} está pusheada.`,
          log,
        );
        return;
      }

      // 6. Éxito → cleanup del worktree (la rama vive en el remoto).
      await this.steps.cleanup();
      emitProgress('done');
      void this.bus.emit('selfdev:done', {
        sessionId,
        topic,
        ok: true,
        branch,
        ...(pr.url !== undefined ? { prUrl: pr.url } : {}),
      });
      log.info(`sesión OK — PR: ${pr.url ?? branch}`);
      await this.announce(
        `Listo, abrí el PR sobre "${topic}": ${pr.url ?? branch}. Cuando puedas, revisalo y mergealo vos.`,
        'divertida',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('sesión self-dev lanzó una excepción', { err });
      void this.bus.emit('selfdev:done', { sessionId, topic, ok: false, reason: msg });
      await this.announce(
        `Se me rompió la sesión de self-dev sobre "${topic}": ${msg}.`,
        'neutral',
      );
    } finally {
      this.running = false;
    }
  }

  /** Camino de fallo controlado: emite `done {ok:false}` + reporta, sin cleanup. */
  private async fail(
    sessionId: string,
    topic: string,
    branch: string | undefined,
    reason: string,
    log: Logger,
  ): Promise<void> {
    log.warn(`sesión self-dev abortó: ${reason}`);
    void this.bus.emit('selfdev:done', {
      sessionId,
      topic,
      ok: false,
      reason,
      ...(branch !== undefined ? { branch } : {}),
    });
    await this.announce(reason, 'neutral');
  }
}
