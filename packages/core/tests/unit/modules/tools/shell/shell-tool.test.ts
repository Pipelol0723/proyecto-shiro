/**
 * Tests de la tool `shell:exec` (ADR 0022 §3): el allowlist (núcleo de
 * seguridad, puro) y la ejecución real. La ejecución usa `process.execPath`
 * (el binario de node, absoluto) para ser determinista cross-platform.
 */

import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { Logger } from '../../../../../src/core/logger.js';
import type { ToolContext } from '../../../../../src/interfaces/IToolModule.js';
import {
  ShellAllowlist,
  ShellExecTool,
  ShellToolConfigSchema,
} from '../../../../../src/modules/tools/shell/shell-tool.js';

function ctx(): ToolContext {
  return { logger: new Logger('error', { module: 'test' }), userId: 'me' };
}

const NODE = process.execPath;

// ─── ShellAllowlist (núcleo de seguridad) ─────────────────────────────

describe('ShellAllowlist', () => {
  const allow = new ShellAllowlist([{ cmd: 'git', allowed_args_pattern: '^(status|log|diff)\\b' }]);

  it('permite un comando del allowlist con args que casan', () => {
    expect(allow.check('git', 'status').ok).toBe(true);
    expect(allow.check('git', 'log --oneline').ok).toBe(true);
  });

  it('rechaza un comando que no está en el allowlist', () => {
    const r = allow.check('rm', '-rf /');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no permitido');
  });

  it('rechaza args que no casan el patrón', () => {
    const r = allow.check('git', 'push --force');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('argumentos no permitidos');
  });

  it('list() devuelve los comandos permitidos', () => {
    expect(allow.list()).toEqual(['git']);
  });
});

describe('ShellToolConfigSchema', () => {
  it('rechaza un patrón de regex inválido', () => {
    const r = ShellToolConfigSchema.safeParse({
      commands: [{ cmd: 'git', allowed_args_pattern: '(' }],
    });
    expect(r.success).toBe(false);
  });

  it('aplica defaults sensatos', () => {
    const cfg = ShellToolConfigSchema.parse({});
    expect(cfg.commands).toEqual([]);
    expect(cfg.timeout_ms).toBe(30_000);
    expect(cfg.cwd).toContain('shiro-workspace');
  });
});

// ─── ShellExecTool (ejecución real) ───────────────────────────────────

describe('ShellExecTool', () => {
  function tool(timeoutMs = 5000): ShellExecTool {
    const allow = new ShellAllowlist([{ cmd: NODE, allowed_args_pattern: '.*' }]);
    return new ShellExecTool(allow, tmpdir(), timeoutMs);
  }

  it('es tier confirm', () => {
    expect(tool().permissionTier).toBe('confirm');
  });

  it('ejecuta un comando permitido y captura stdout', async () => {
    const res = await tool().execute(
      { command: NODE, args: ['-e', 'process.stdout.write("hola")'] },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(res.output).toBe('hola');
  });

  it('rechaza un comando fuera del allowlist', async () => {
    const res = await tool().execute({ command: 'rm', args: ['-rf', '/'] }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no permitido');
  });

  it('rechaza args inválidos (schema)', async () => {
    const res = await tool().execute({}, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('args');
  });

  it('reporta exit code distinto de 0', async () => {
    const res = await tool().execute({ command: NODE, args: ['-e', 'process.exit(3)'] }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('3');
  });

  it('mata el comando al superar el timeout', async () => {
    const res = await tool(200).execute(
      { command: NODE, args: ['-e', 'setTimeout(() => undefined, 5000)'] },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('timeout');
  });

  it('falla si el comando no existe en PATH', async () => {
    const allow = new ShellAllowlist([
      { cmd: 'definitely_not_a_cmd_xyz', allowed_args_pattern: '.*' },
    ]);
    const res = await new ShellExecTool(allow, tmpdir(), 5000).execute(
      { command: 'definitely_not_a_cmd_xyz', args: [] },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no encontrado');
  });
});
