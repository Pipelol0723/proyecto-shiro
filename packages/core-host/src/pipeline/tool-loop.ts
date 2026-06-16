/**
 * Wiring del loop tool-use del lado del pipeline (ADR 0022 §5). Construye
 * las definiciones de tools para el LLM y el `executeTool` que el LLM
 * invoca en su loop. Aquí vive el **gate de permisos**:
 *
 * - tier `auto` (`fs:read`, `fs:list`) → se ejecuta y se devuelve el
 *   resultado al modelo.
 * - tier `confirm` (`fs:write`, `fs:delete`, `shell:exec`) → se pide
 *   **aprobación humana** vía el `ApprovalGate`: el loop se pausa hasta que
 *   el usuario aprueba (se ejecuta) o cancela (se devuelve "no aprobada").
 *   El modal del cliente materializa esa decisión (ADR 0022 §4).
 *
 * El LLM (`AnthropicLLM.generateWithTools`) no sabe nada de tiers, del gate
 * ni de la registry — solo recibe definiciones y un callback.
 */

import { randomUUID } from 'node:crypto';
import { toLLMToolDefinitions } from '@proyecto-shiro/core';
import type {
  IToolModule,
  IToolsRegistry,
  LLMToolDefinition,
  LLMToolExecutor,
  Logger,
  MemoryEntry,
  ToolContext,
  ToolTurnMetadata,
} from '@proyecto-shiro/core';
import type { ApprovalGate } from './approval-gate.js';

/**
 * Callback que recibe el `MemoryEntry` (rol `tool`) de cada acción ejecutada
 * o cancelada, para que el pipeline lo persista (ADR 0022 §6). El pipeline lo
 * provee; el loop no sabe nada de memoria.
 */
export type ToolTurnRecorder = (entry: MemoryEntry) => void;

const RESULT_NO_APROBADO = 'El usuario no aprobó esta acción. No se ejecutó.';

/** Trunca un string largo para no inflar previews ni resúmenes de memoria. */
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Args → resumen legible y acotado para el modal de aprobación. */
function previewArgs(args: unknown): string {
  return truncate(JSON.stringify(args) ?? String(args), 200);
}

/**
 * Construye el turno de memoria (rol `tool`) de una acción. El `text` es un
 * resumen en primera persona (alimenta contexto y embeddings); los detalles
 * estructurados van en `metadata` (ver {@link ToolTurnMetadata}).
 */
function buildToolTurnEntry(
  tool: IToolModule,
  args: unknown,
  result: { ok: boolean; output: string },
  approved: boolean | null,
  userId: string,
): MemoryEntry {
  const argsPreview = previewArgs(args);
  let text: string;
  if (approved === false) {
    text = `Pedí permiso para ejecutar ${tool.id} con ${argsPreview}, pero no me lo aprobaste, así que no lo hice.`;
  } else if (result.ok) {
    text = `Ejecuté ${tool.id} con ${argsPreview}. Resultado: ${truncate(result.output, 300)}`;
  } else {
    text = `Intenté ejecutar ${tool.id} con ${argsPreview}, pero falló: ${truncate(result.output, 300)}`;
  }
  return {
    id: randomUUID(),
    role: 'tool',
    text,
    timestamp: new Date().toISOString(),
    userId,
    metadata: {
      kind: 'tool',
      toolId: tool.id,
      toolName: tool.name,
      args,
      result,
      approved,
    } satisfies ToolTurnMetadata,
  };
}

/** Definiciones (name + description + JSON Schema) de todas las tools. */
export function buildToolDefs(registry: IToolsRegistry): LLMToolDefinition[] {
  return toLLMToolDefinitions(registry.list());
}

/**
 * Crea el `executeTool` que el LLM llama en su loop. Mapea `name`
 * (`fs_read`) → tool (`fs:read`), aplica el gate de tier y ejecuta. Las
 * tools `confirm` pasan por el `ApprovalGate` (modal del cliente). Cada
 * acción (ejecutada o cancelada) se reporta vía `recordTurn` para
 * persistirla en memoria (ADR 0022 §6).
 */
export function makeToolExecutor(
  registry: IToolsRegistry,
  ctx: ToolContext,
  logger: Logger,
  gate: ApprovalGate,
  recordTurn?: ToolTurnRecorder,
): LLMToolExecutor {
  const byName = new Map<string, IToolModule>(registry.list().map((t) => [t.name, t]));
  return async (name, args) => {
    const tool = byName.get(name);
    if (tool === undefined) {
      // Tool inexistente: no es un turno real, no se persiste.
      return { ok: false, output: `tool desconocida: ${name}` };
    }
    if (tool.permissionTier === 'confirm') {
      const approved = await gate.requestApproval({
        toolId: tool.id,
        toolName: tool.name,
        argsPreview: previewArgs(args),
        userId: ctx.userId,
      });
      if (!approved) {
        logger.info(`tool ${tool.id} NO aprobada por el usuario — cancelada`);
        const rejected = { ok: false, output: RESULT_NO_APROBADO };
        recordTurn?.(buildToolTurnEntry(tool, args, rejected, false, ctx.userId));
        return rejected;
      }
      logger.info(`tool ${tool.id} aprobada por el usuario`);
    }
    const result = await tool.execute(args, ctx);
    logger.info(`tool ${tool.id} ejecutada (ok=${String(result.ok)})`);
    const output = result.ok ? result.output : (result.error ?? 'error');
    const approved = tool.permissionTier === 'confirm' ? true : null;
    recordTurn?.(buildToolTurnEntry(tool, args, { ok: result.ok, output }, approved, ctx.userId));
    return { ok: result.ok, output };
  };
}
