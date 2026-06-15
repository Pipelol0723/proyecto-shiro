/**
 * Wiring del loop tool-use del lado del pipeline (ADR 0022 §5). Construye
 * las definiciones de tools para el LLM y el `executeTool` que el LLM
 * invoca en su loop. Aquí vive el **gate de permisos**:
 *
 * - tier `auto` (`fs:read`, `fs:list`) → se ejecuta y se devuelve el
 *   resultado al modelo.
 * - tier `confirm` (`fs:write`, `fs:delete`, `shell:exec`) → **NO** se
 *   ejecuta en este PR; se devuelve un mensaje de "requiere aprobación"
 *   que el modelo entiende. El modal que lo habilita es el PR #5.
 *
 * El LLM (`AnthropicLLM.generateWithTools`) no sabe nada de tiers ni de la
 * registry — solo recibe definiciones y un callback.
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

/** Definiciones (name + description + JSON Schema) de todas las tools. */
export function buildToolDefs(registry: IToolsRegistry): LLMToolDefinition[] {
  return toLLMToolDefinitions(registry.list());
}

/**
 * Crea el `executeTool` que el LLM llama en su loop. Mapea `name`
 * (`fs_read`) → tool (`fs:read`), aplica el gate de tier y ejecuta.
 */
export function makeToolExecutor(
  registry: IToolsRegistry,
  ctx: ToolContext,
  logger: Logger,
): LLMToolExecutor {
  const byName = new Map<string, IToolModule>(registry.list().map((t) => [t.name, t]));
  return async (name, args) => {
    const tool = byName.get(name);
    if (tool === undefined) {
      return { ok: false, output: `tool desconocida: ${name}` };
    }
    if (tool.permissionTier === 'confirm') {
      logger.info(`tool ${tool.id} requiere aprobación — no ejecutada (modal del PR #5 pendiente)`);
      return {
        ok: false,
        output:
          'Esta acción requiere la aprobación del usuario, que todavía no está disponible. No se ejecutó.',
      };
    }
    const result = await tool.execute(args, ctx);
    logger.info(`tool ${tool.id} ejecutada (ok=${String(result.ok)})`);
    return { ok: result.ok, output: result.ok ? result.output : (result.error ?? 'error') };
  };
}
