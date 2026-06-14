/**
 * Tools de filesystem (ADR 0022 §3): `fs:read`, `fs:list` (`auto`),
 * `fs:write`, `fs:delete` (`confirm`). Cada una implementa `IToolModule`,
 * valida sus args con Zod y opera **solo dentro del scope** (`FsScope`).
 *
 * Las tools NO lanzan por errores esperables (archivo inexistente, fuera
 * de scope, etc.): los devuelven como `ToolResult.ok=false` para que el
 * LLM los vea como `tool_result` y los explique.
 *
 * Node-only — viven en `@proyecto-shiro/core/node` (ADR 0011).
 *
 * **Estado en este PR**: `fs:write`/`fs:delete` quedan implementadas y
 * registradas pero **dormidas** — nada las invoca hasta el loop tool-use
 * (PR #4) y su tier `confirm` lo gatea el modal de aprobación (PR #5).
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ModuleDeps } from '../../../core/module-loader.js';
import type { IToolModule, ToolContext, ToolResult } from '../../../interfaces/IToolModule.js';
import type { IToolsRegistry } from '../../../interfaces/IToolsRegistry.js';
import { FsScope, FsScopeConfigSchema } from './fs-scope.js';

export class FsToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FsToolError';
  }
}

const PathArgs = z.object({ path: z.string().min(1) });
const WriteArgs = z.object({ path: z.string().min(1), content: z.string() });

function invalidArgs(error: z.ZodError): ToolResult {
  return {
    ok: false,
    output: '',
    error: `args inválidos: ${error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`,
  };
}

function fail(error: string): ToolResult {
  return { ok: false, output: '', error };
}

function errMsg(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  return code ?? (err instanceof Error ? err.message : String(err));
}

// ─── fs:read ──────────────────────────────────────────────────────────

export class FsReadTool implements IToolModule {
  readonly id = 'fs:read';
  readonly name = 'fs_read';
  readonly description =
    'Lee el contenido de un archivo de texto dentro del workspace permitido y devuelve el texto.';
  readonly schema = PathArgs;
  readonly permissionTier = 'auto' as const;

  constructor(private readonly scope: FsScope) {}

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) return invalidArgs(parsed.error);
    const r = await this.scope.resolve(parsed.data.path, true);
    if (!r.ok) return fail(r.error);
    try {
      const stat = await fs.stat(r.abs);
      if (!stat.isFile()) return fail(`no es un archivo: ${parsed.data.path}`);
      if (stat.size > this.scope.maxReadBytes) {
        return fail(
          `archivo demasiado grande (${String(stat.size)} B > ${String(this.scope.maxReadBytes)} B)`,
        );
      }
      const content = await fs.readFile(r.abs, 'utf8');
      return { ok: true, output: content, data: { path: r.abs, bytes: stat.size } };
    } catch (err) {
      return fail(`error leyendo: ${errMsg(err)}`);
    }
  }
}

// ─── fs:list ──────────────────────────────────────────────────────────

export class FsListTool implements IToolModule {
  readonly id = 'fs:list';
  readonly name = 'fs_list';
  readonly description =
    'Lista los archivos y subdirectorios de un directorio dentro del workspace permitido.';
  readonly schema = PathArgs;
  readonly permissionTier = 'auto' as const;

  constructor(private readonly scope: FsScope) {}

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) return invalidArgs(parsed.error);
    const r = await this.scope.resolve(parsed.data.path, true);
    if (!r.ok) return fail(r.error);
    try {
      const stat = await fs.stat(r.abs);
      if (!stat.isDirectory()) return fail(`no es un directorio: ${parsed.data.path}`);
      const entries = await fs.readdir(r.abs, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? ('dir' as const) : ('file' as const),
      }));
      const output =
        items.length === 0
          ? '(directorio vacío)'
          : items.map((i) => `${i.type === 'dir' ? '[d]' : '[f]'} ${i.name}`).join('\n');
      return { ok: true, output, data: { path: r.abs, entries: items } };
    } catch (err) {
      return fail(`error listando: ${errMsg(err)}`);
    }
  }
}

// ─── fs:write (confirm) ───────────────────────────────────────────────

export class FsWriteTool implements IToolModule {
  readonly id = 'fs:write';
  readonly name = 'fs_write';
  readonly description =
    'Escribe (crea o sobrescribe) un archivo de texto dentro del workspace permitido. Pide confirmación.';
  readonly schema = WriteArgs;
  readonly permissionTier = 'confirm' as const;

  constructor(private readonly scope: FsScope) {}

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) return invalidArgs(parsed.error);
    const r = await this.scope.resolve(parsed.data.path, false);
    if (!r.ok) return fail(r.error);
    try {
      await fs.mkdir(dirname(r.abs), { recursive: true });
      await fs.writeFile(r.abs, parsed.data.content, 'utf8');
      const bytes = Buffer.byteLength(parsed.data.content);
      return {
        ok: true,
        output: `escrito ${String(bytes)} B en ${r.abs}`,
        data: { path: r.abs, bytes, preview: parsed.data.content.slice(0, 200) },
      };
    } catch (err) {
      return fail(`error escribiendo: ${errMsg(err)}`);
    }
  }
}

// ─── fs:delete (confirm) ──────────────────────────────────────────────

export class FsDeleteTool implements IToolModule {
  readonly id = 'fs:delete';
  readonly name = 'fs_delete';
  readonly description =
    'Borra un archivo dentro del workspace permitido. No borra directorios. Pide confirmación.';
  readonly schema = PathArgs;
  readonly permissionTier = 'confirm' as const;

  constructor(private readonly scope: FsScope) {}

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) return invalidArgs(parsed.error);
    const r = await this.scope.resolve(parsed.data.path, true);
    if (!r.ok) return fail(r.error);
    try {
      const stat = await fs.stat(r.abs);
      if (stat.isDirectory()) {
        return fail('borrar directorios no está permitido en V1 (solo archivos)');
      }
      await fs.unlink(r.abs);
      return { ok: true, output: `borrado: ${r.abs}` };
    } catch (err) {
      return fail(`error borrando: ${errMsg(err)}`);
    }
  }
}

// ─── Registro ─────────────────────────────────────────────────────────

/**
 * Construye el `FsScope` desde la config (`tools.config.fs`) e instancia +
 * registra las 4 tools FS en el registry. Lo llama el bootstrap del
 * core-host tras `orchestrator.init()`. Asegura los roots best-effort
 * (crea el sandbox por defecto si falta).
 */
export function registerFsTools(
  registry: IToolsRegistry,
  rawConfig: unknown,
  deps: ModuleDeps,
): void {
  const logger = deps.logger.child({ module: 'FsTools' });
  const parsed = FsScopeConfigSchema.safeParse(rawConfig ?? {});
  if (!parsed.success) {
    throw new FsToolError(
      `config fs inválida — ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const scope = new FsScope(parsed.data);
  // Crea los roots si faltan (best-effort: el sandbox por defecto debe
  // existir para que read/list/write no fallen al primer uso).
  void Promise.allSettled(scope.roots.map((root) => fs.mkdir(root, { recursive: true })));

  const tools: IToolModule[] = [
    new FsReadTool(scope),
    new FsListTool(scope),
    new FsWriteTool(scope),
    new FsDeleteTool(scope),
  ];
  for (const tool of tools) registry.register(tool);

  logger.info(
    `tools FS registradas: ${tools.map((t) => t.id).join(', ')} (scope: ${
      scope.roots.join(', ') || '<vacío>'
    })`,
  );
}
