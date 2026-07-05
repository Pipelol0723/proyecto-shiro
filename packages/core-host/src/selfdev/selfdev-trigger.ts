/**
 * Tool `selfdev:propose` (ADR 0023) — el **disparador** del flujo de
 * self-improvement. Vive en el registry agéntico del usuario (el del chat), así
 * que la LLM la llama cuando el usuario le pide "proponé un fix / implementá una
 * mejora en tu propio código".
 *
 * Es tier `confirm`: el modal de aprobación (ADR 0022 §4) pregunta antes de
 * arrancar la sesión. Al aprobar, `execute` invoca `onPropose`, que **lanza la
 * `SelfDevSession` en background** (corre minutos: worktree → generar → eval →
 * PR) y devuelve de inmediato — el turno del chat NO se bloquea. El progreso y
 * el resultado llegan por `selfdev:progress`/`selfdev:done` y Shiro los anuncia.
 *
 * `onPropose` decide de forma **síncrona** si acepta arrancar (p.ej. rechaza si
 * ya hay una sesión en curso — el worktree es único), y el `execute` refleja esa
 * decisión en el `ToolResult`.
 *
 * Node-only (`@proyecto-shiro/core-host`).
 */

import { z } from 'zod';
import type { Logger } from '@proyecto-shiro/core';
import type { IToolModule, IToolsRegistry, ToolContext, ToolResult } from '@proyecto-shiro/core';

/** Decisión síncrona de arrancar (o no) una sesión de self-dev. */
export interface ProposeDecision {
  /** True si la sesión se arrancó (en background). */
  accepted: boolean;
  /** Motivo cuando `accepted` es `false` (p.ej. "ya hay una sesión activa"). */
  reason?: string;
}

/**
 * Callback que arranca la sesión. Lo provee `wireSelfDev`: hace el chequeo de
 * "¿hay una sesión activa?" y, si no, dispara `void session.run(topic, summary)`
 * (fire-and-forget). Devuelve la decisión para el ack del chat.
 */
export type SelfDevProposeHandler = (topic: string, summary?: string) => ProposeDecision;

const ProposeArgs = z.object({
  /** Tema libre del cambio (p.ej. "arreglar el lip-sync cuando el TTS falla"). */
  topic: z.string().min(1),
  /** Detalle opcional de qué se busca — ayuda al sub-loop de generación. */
  summary: z.string().optional(),
});

export class SelfDevProposeTool implements IToolModule {
  readonly id = 'selfdev:propose';
  readonly name = 'selfdev_propose';
  readonly description =
    'Arranca una sesión de self-improvement: creás un worktree aislado de tu repo, ' +
    'generás un cambio de código, corrés el eval (format/lint/typecheck/test) y abrís un ' +
    'Pull Request para que el humano lo revise (nunca lo mergeás vos). Pide confirmación. ' +
    'Usala cuando el usuario te pida proponer, implementar o arreglar algo en tu propio código. ' +
    'NO sirve para cambios al carácter, ADRs ni permisos (esos son inmutables).';
  readonly schema = ProposeArgs;
  readonly permissionTier = 'confirm' as const;

  constructor(private readonly onPropose: SelfDevProposeHandler) {}

  // No es `async`: `onPropose` es síncrono (arranca la sesión en background y
  // devuelve la decisión). Envolvemos en `Promise.resolve` para cumplir el
  // contrato `Promise<ToolResult>` sin un `await` vacío.
  execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) {
      return Promise.resolve({
        ok: false,
        output: '',
        error: `args inválidos: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
    }
    const { topic, summary } = parsed.data;
    const decision = this.onPropose(topic, summary);
    if (!decision.accepted) {
      return Promise.resolve({
        ok: false,
        output: '',
        error: decision.reason ?? 'no se pudo arrancar la sesión de self-dev',
      });
    }
    return Promise.resolve({
      ok: true,
      output: `Sesión de self-dev arrancada sobre "${topic}". Voy a trabajarlo en un worktree aislado; te aviso del progreso y te pido que apruebes el PR al final.`,
      data: { topic },
    });
  }
}

/**
 * Registra `selfdev:propose` en el registry agéntico del usuario (el del chat).
 * Lo llama `wireSelfDev` cuando el entorno soporta self-dev (repo + git/gh/npm).
 */
export function registerSelfDevTrigger(
  registry: IToolsRegistry,
  opts: { onPropose: SelfDevProposeHandler; logger?: Logger },
): void {
  registry.register(new SelfDevProposeTool(opts.onPropose));
  opts.logger?.child({ module: 'SelfDevTrigger' }).info('tool selfdev:propose registrada');
}
