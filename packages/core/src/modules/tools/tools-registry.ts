/**
 * ToolsRegistry — registro in-memory de las herramientas agénticas
 * (ADR 0022 §1). Implementa `IToolsRegistry` y ocupa el slot `tools` del
 * orchestrator. Browser-safe: solo agrupa `IToolModule`; las tools que
 * tocan FS/shell son Node-only y se registran aquí desde el bootstrap del
 * `core-host` (PRs siguientes).
 *
 * En este PR (andamiaje) el registry arranca **vacío**. El registro de
 * las tools concretas (`fs:read`, `shell:exec`, …) y la lectura del scope
 * desde `config` (`fs.paths`, `shell.commands`) llegan en los PRs de tools
 * FS/shell (ADR 0022 §3).
 */

import { z } from 'zod';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import type { IToolModule } from '../../interfaces/IToolModule.js';
import type { IToolsRegistry, ToolDefinition } from '../../interfaces/IToolsRegistry.js';

// ─── Schema de config ─────────────────────────────────────────────────

/**
 * Config del registry. En PR #1 está vacía (placeholder). `catchall`
 * deja pasar claves futuras (`fs`, `shell`) sin que el parse falle si un
 * dev las añade adelantándose a los PRs de tools. Cada tool validará su
 * propia sub-config con su propio schema cuando llegue.
 */
export const ToolsRegistryConfigSchema = z.object({}).catchall(z.unknown());

export type ToolsRegistryConfig = z.infer<typeof ToolsRegistryConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class ToolsRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolsRegistryError';
  }
}

// ─── Implementación ───────────────────────────────────────────────────

export class ToolsRegistry implements IToolsRegistry {
  readonly id = 'tools:registry';
  private readonly tools = new Map<string, IToolModule>();
  private readonly logger: Logger;

  constructor(rawConfig: unknown, deps: ModuleDeps) {
    const parsed = ToolsRegistryConfigSchema.safeParse(rawConfig ?? {});
    if (!parsed.success) {
      throw new ToolsRegistryError(
        `ToolsRegistry: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.logger = deps.logger.child({ module: 'ToolsRegistry' });
    this.logger.debug('inicializado (sin tools — andamiaje, ADR 0022 PR #1)');
  }

  register(tool: IToolModule): void {
    if (this.tools.has(tool.id)) {
      throw new ToolsRegistryError(
        `tool con id '${tool.id}' ya registrada — los ids deben ser únicos`,
      );
    }
    this.tools.set(tool.id, tool);
    this.logger.debug(`tool registrada: ${tool.id} (${tool.permissionTier})`);
  }

  get(id: string): IToolModule | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(): readonly IToolModule[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.list().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      permissionTier: tool.permissionTier,
    }));
  }
}
