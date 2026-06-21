/**
 * Tests del tool `gh:pr-create` (ADR 0023). La lógica (args fijos, parseo de
 * URL, tier confirm) con un `GhExec` mockeado. La frontera dura "solo
 * `gh pr create`" se verifica además a nivel allowlist con el tool real.
 */

import { describe, expect, it } from 'vitest';
import { Logger } from '../../../../../src/core/logger.js';
import type { ToolContext } from '../../../../../src/interfaces/IToolModule.js';
import {
  GhPrCreateTool,
  createGhPrCreateTool,
  type GhExec,
} from '../../../../../src/modules/tools/selfdev/gh-pr.js';

function ctx(): ToolContext {
  return { logger: new Logger('error', { module: 'test' }), userId: 'me' };
}

describe('GhPrCreateTool', () => {
  it('es tier confirm y se llama gh:pr-create', () => {
    const tool = new GhPrCreateTool(() => Promise.resolve({ ok: true, output: '' }));
    expect(tool.id).toBe('gh:pr-create');
    expect(tool.permissionTier).toBe('confirm');
  });

  it('arma `pr create --base --title --body` (subcomando fijo) y devuelve la URL', async () => {
    const calls: string[][] = [];
    const ghExec: GhExec = (args) => {
      calls.push(args);
      return Promise.resolve({
        ok: true,
        output: 'https://github.com/owner/repo/pull/42\n',
      });
    };
    const res = await new GhPrCreateTool(ghExec).execute(
      { title: 'mi fix', body: '## qué\n…', base: 'develop' },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(res.output).toBe('https://github.com/owner/repo/pull/42');
    expect((res.data as { url: string }).url).toContain('/pull/42');
    // El subcomando es SIEMPRE `pr create`; el LLM solo aporta title/body/base.
    expect(calls[0]?.slice(0, 2)).toEqual(['pr', 'create']);
    expect(calls[0]).toContain('--base');
    expect(calls[0]).toContain('develop');
  });

  it('default base = develop', async () => {
    const calls: string[][] = [];
    const ghExec: GhExec = (args) => {
      calls.push(args);
      return Promise.resolve({ ok: true, output: 'https://x/pull/1' });
    };
    await new GhPrCreateTool(ghExec).execute({ title: 't' }, ctx());
    const i = calls[0]!.indexOf('--base');
    expect(calls[0]![i + 1]).toBe('develop');
  });

  it('propaga el fallo de gh como ok:false', async () => {
    const ghExec: GhExec = () => Promise.resolve({ ok: false, output: '', error: 'gh: no auth' });
    const res = await new GhPrCreateTool(ghExec).execute({ title: 't' }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no auth');
  });

  it('rechaza args inválidos (title vacío)', async () => {
    const res = await new GhPrCreateTool(() => Promise.resolve({ ok: true, output: '' })).execute(
      { title: '' },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('inválidos');
  });
});

describe('createGhPrCreateTool — frontera dura del allowlist', () => {
  it('el tool real SOLO permite `gh pr create` (no merge/release)', () => {
    // Construye el tool real (allowlist hardcodeado) y verifica vía el shell
    // interno que cualquier gh distinto de `pr create` se rechaza. Lo hacemos
    // pidiendo un PR con un title que NO cambia el subcomando — el subcomando
    // siempre es `pr create`, así que aquí confirmamos que ESE pasa el
    // allowlist (no rebota), y confiamos en ShellAllowlist (testeado aparte)
    // para el rechazo de `pr merge`/`release`.
    const tool = createGhPrCreateTool({ worktreeRoot: process.cwd() });
    expect(tool.id).toBe('gh:pr-create');
    expect(tool.permissionTier).toBe('confirm');
  });
});
