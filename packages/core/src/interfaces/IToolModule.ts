import type { ZodType } from 'zod';
import type { Logger } from '../core/logger.js';

/**
 * Nivel de permiso de una herramienta (ADR 0022 §4):
 * - `auto`: se ejecuta sin interrumpir (lecturas reversibles, baratas).
 * - `confirm`: pide aprobación humana antes de ejecutar (escrituras /
 *   destructivas). El pipeline dispara `tool:requires-approval` y pausa
 *   hasta que el cliente devuelve `tool:approval`.
 */
export type PermissionTier = 'auto' | 'confirm';

/**
 * Contexto que el pipeline inyecta en cada ejecución de tool.
 */
export interface ToolContext {
  /** Logger hijo para la tool (auditoría). */
  logger: Logger;
  /** Usuario dueño del turno — para scoping y auditoría. */
  userId: string;
  /** Señal para abortar ejecuciones largas (timeout / cancelación). */
  signal?: AbortSignal;
}

/**
 * Resultado de ejecutar una tool. Las tools NO lanzan por errores
 * esperables (archivo inexistente, comando fuera del allowlist): los
 * reportan con `ok: false` + `error`, para que el LLM lo vea como
 * `tool_result` y se lo explique al usuario.
 */
export interface ToolResult {
  ok: boolean;
  /** Salida en texto — lo que el LLM recibe como `tool_result`. */
  output: string;
  /** Datos estructurados opcionales (p.ej. lista de archivos). */
  data?: unknown;
  /** Mensaje de error legible cuando `ok` es `false`. */
  error?: string;
}

/**
 * Contrato de una herramienta ejecutable (ADR 0022 §2).
 *
 * El tipo es browser-safe (el cliente lee `name`/`description`/
 * `permissionTier` para el modal de aprobación), pero las
 * implementaciones que tocan FS o shell son **Node-only** y viven en
 * `@proyecto-shiro/core/node` (ADR 0011), igual que `SystemTTS` o
 * `MemoryManager`.
 */
export interface IToolModule {
  /** Id único, namespaced. P.ej. `fs:read`, `shell:exec`. */
  readonly id: string;
  /**
   * Nombre para el LLM. Debe casar con `^[a-zA-Z0-9_-]{1,64}$` (la API
   * de tool-use de Claude no admite `:`), así que normalmente es el `id`
   * con `:` → `_` (p.ej. `fs_read`).
   */
  readonly name: string;
  /** Descripción para el LLM: qué hace y cuándo usarla. */
  readonly description: string;
  /** Schema zod que valida los `args` antes de ejecutar. */
  readonly schema: ZodType;
  /** `auto` ejecuta directo; `confirm` pide aprobación humana. */
  readonly permissionTier: PermissionTier;
  /**
   * Ejecuta la tool con `args` ya validados contra `schema`. Devuelve un
   * `ToolResult`; solo lanza ante bugs de programación, no ante errores
   * esperables del dominio.
   */
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
