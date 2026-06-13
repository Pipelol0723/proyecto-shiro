/**
 * Tests del `ToolsRegistry` — slot `tools` del orchestrator (ADR 0022 §1).
 * Cubre el andamiaje: registro/recuperación, ids únicos, definiciones
 * ligeras y arranque vacío. Las tools FS/shell reales llegan en PRs
 * siguientes.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import type { IToolModule, ToolResult } from '../../../../src/interfaces/IToolModule.js';
import { ToolsRegistry, ToolsRegistryError } from '../../../../src/modules/tools/tools-registry.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

function fakeTool(over: Partial<IToolModule> = {}): IToolModule {
  return {
    id: 'fs:read',
    name: 'fs_read',
    description: 'Lee un archivo',
    schema: z.object({ path: z.string() }),
    permissionTier: 'auto',
    execute: (): Promise<ToolResult> => Promise.resolve({ ok: true, output: 'ok' }),
    ...over,
  };
}

describe('ToolsRegistry', () => {
  it('arranca vacío', () => {
    const reg = new ToolsRegistry({}, makeDeps());
    expect(reg.list()).toEqual([]);
    expect(reg.getDefinitions()).toEqual([]);
  });

  it('acepta config undefined (default {})', () => {
    expect(() => new ToolsRegistry(undefined, makeDeps())).not.toThrow();
  });

  it('registra y recupera una tool', () => {
    const reg = new ToolsRegistry({}, makeDeps());
    const tool = fakeTool();
    reg.register(tool);
    expect(reg.has('fs:read')).toBe(true);
    expect(reg.get('fs:read')).toBe(tool);
    expect(reg.list()).toHaveLength(1);
  });

  it('get de un id inexistente devuelve undefined', () => {
    const reg = new ToolsRegistry({}, makeDeps());
    expect(reg.get('nope')).toBeUndefined();
    expect(reg.has('nope')).toBe(false);
  });

  it('lanza ToolsRegistryError al registrar un id duplicado', () => {
    const reg = new ToolsRegistry({}, makeDeps());
    reg.register(fakeTool());
    expect(() => reg.register(fakeTool())).toThrow(ToolsRegistryError);
  });

  it('getDefinitions expone la forma ligera de cada tool', () => {
    const reg = new ToolsRegistry({}, makeDeps());
    reg.register(fakeTool());
    reg.register(fakeTool({ id: 'shell:exec', name: 'shell_exec', permissionTier: 'confirm' }));
    expect(reg.getDefinitions()).toEqual([
      { id: 'fs:read', name: 'fs_read', description: 'Lee un archivo', permissionTier: 'auto' },
      {
        id: 'shell:exec',
        name: 'shell_exec',
        description: 'Lee un archivo',
        permissionTier: 'confirm',
      },
    ]);
  });
});
