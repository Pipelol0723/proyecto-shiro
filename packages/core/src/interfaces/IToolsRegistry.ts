import type { IToolModule, PermissionTier } from './IToolModule.js';

/**
 * Definición ligera de una tool, para exponerla al LLM (system prompt /
 * `tool_use`) y al cliente (modal de aprobación). El payload completo de
 * `tool_use` de Claude (con el JSON Schema de los args) lo construye el
 * pipeline conversacional a partir de `IToolModule.schema` — eso llega en
 * el PR del loop tool-use (ADR 0022 §5 / PR #4).
 */
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  permissionTier: PermissionTier;
}

/**
 * Registro de las herramientas disponibles (ADR 0022 §1). Es el slot
 * `tools` del orchestrator: agrupa `IToolModule[]` y los expone al
 * pipeline. Browser-safe (solo agrupa; no ejecuta FS/shell por sí mismo).
 */
export interface IToolsRegistry {
  readonly id: string;
  /** Registra una tool. Lanza si ya hay otra con el mismo `id`. */
  register(tool: IToolModule): void;
  /** Devuelve la tool por `id`, o `undefined` si no existe. */
  get(id: string): IToolModule | undefined;
  /** True si hay una tool registrada con ese `id`. */
  has(id: string): boolean;
  /** Todas las tools registradas (snapshot). */
  list(): readonly IToolModule[];
  /** Definiciones ligeras de todas las tools (para LLM / cliente). */
  getDefinitions(): ToolDefinition[];
}
