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

import { toLLMToolDefinitions } from '@proyecto-shiro/core';
import type {
  IToolModule,
  IToolsRegistry,
  LLMToolDefinition,
  LLMToolExecutor,
  Logger,
  ToolContext,
} from '@proyecto-shiro/core';
import type { ApprovalGate } from './approval-gate.js';

/** Args → resumen legible y acotado para el modal de aprobación. */
function previewArgs(args: unknown): string {
  const json = JSON.stringify(args) ?? String(args);
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

/** Definiciones (name + description + JSON Schema) de todas las tools. */
export function buildToolDefs(registry: IToolsRegistry): LLMToolDefinition[] {
  return toLLMToolDefinitions(registry.list());
}

/**
 * Crea el `executeTool` que el LLM llama en su loop. Mapea `name`
 * (`fs_read`) → tool (`fs:read`), aplica el gate de tier y ejecuta. Las
 * tools `confirm` pasan por el `ApprovalGate` (modal del cliente).
 */
export function makeToolExecutor(
  registry: IToolsRegistry,
  ctx: ToolContext,
  logger: Logger,
  gate: ApprovalGate,
): LLMToolExecutor {
  const byName = new Map<string, IToolModule>(registry.list().map((t) => [t.name, t]));
  return async (name, args) => {
    const tool = byName.get(name);
    if (tool === undefined) {
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
        return { ok: false, output: 'El usuario no aprobó esta acción. No se ejecutó.' };
      }
      logger.info(`tool ${tool.id} aprobada por el usuario`);
    }
    const result = await tool.execute(args, ctx);
    logger.info(`tool ${tool.id} ejecutada (ok=${String(result.ok)})`);
    return { ok: result.ok, output: result.ok ? result.output : (result.error ?? 'error') };
  };
}
