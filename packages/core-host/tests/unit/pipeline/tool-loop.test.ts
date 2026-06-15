/**
 * Tests del wiring del loop tool-use (`tool-loop.ts`): que `buildToolDefs`
 * produce definiciones con JSON Schema y que `makeToolExecutor` aplica el
 * gate de permisos (auto ejecuta, confirm pide aprobación).
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EventBus, Logger, ToolsRegistry } from '@proyecto-shiro/core';
import type { IToolModule, ModuleDeps, ToolContext } from '@proyecto-shiro/core';
import { buildToolDefs, makeToolExecutor } from '../../../src/pipeline/tool-loop.js';

function deps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

function ctx(): ToolContext {
  return { logger: new Logger('error', { module: 'test' }), userId: 'me' };
}

function fakeTool(over: Partial<IToolModule> = {}): IToolModule {
  return {
    id: 'fs:read',
    name: 'fs_read',
    description: 'Lee un archivo',
    schema: z.object({ path: z.string() }),
    permissionTier: 'auto',
    execute: () => Promise.resolve({ ok: true, output: 'contenido' }),
    ...over,
  };
}

function registryWith(tools: IToolModule[]): ToolsRegistry {
  const reg = new ToolsRegistry({}, deps());
  for (const t of tools) reg.register(t);
  return reg;
}

describe('buildToolDefs', () => {
  it('convierte las tools a definiciones con JSON Schema', () => {
    const defs = buildToolDefs(registryWith([fakeTool()]));
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('fs_read');
    expect(defs[0]?.inputSchema).toMatchObject({ type: 'object' });
  });
});

describe('makeToolExecutor', () => {
  it('ejecuta una tool auto y devuelve su output', async () => {
    const exec = vi.fn(() => Promise.resolve({ ok: true, output: 'hola' }));
    const reg = registryWith([fakeTool({ execute: exec })]);
    const run = makeToolExecutor(reg, ctx(), new Logger('error'));

    const res = await run('fs_read', { path: 'a.txt' });

    expect(exec).toHaveBeenCalledWith({ path: 'a.txt' }, expect.anything());
    expect(res).toEqual({ ok: true, output: 'hola' });
  });

  it('NO ejecuta una tool confirm — pide aprobación', async () => {
    const exec = vi.fn(() => Promise.resolve({ ok: true, output: 'x' }));
    const reg = registryWith([
      fakeTool({ id: 'fs:write', name: 'fs_write', permissionTier: 'confirm', execute: exec }),
    ]);
    const run = makeToolExecutor(reg, ctx(), new Logger('error'));

    const res = await run('fs_write', { path: 'a.txt' });

    expect(exec).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.output).toContain('aprobación');
  });

  it('tool desconocida → error', async () => {
    const run = makeToolExecutor(registryWith([fakeTool()]), ctx(), new Logger('error'));
    const res = await run('no_existe', {});
    expect(res.ok).toBe(false);
    expect(res.output).toContain('desconocida');
  });

  it('propaga el error de una tool auto que falla', async () => {
    const reg = registryWith([
      fakeTool({ execute: () => Promise.resolve({ ok: false, output: '', error: 'no existe' }) }),
    ]);
    const run = makeToolExecutor(reg, ctx(), new Logger('error'));

    const res = await run('fs_read', { path: 'x' });

    expect(res.ok).toBe(false);
    expect(res.output).toBe('no existe');
  });
});
