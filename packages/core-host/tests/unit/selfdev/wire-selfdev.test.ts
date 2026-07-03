/**
 * Tests de `wireSelfDev`: la lógica de habilitación (dev-only + tool-use) y el
 * registro del trigger. El detector de entorno se inyecta para no depender de
 * git/gh reales de la máquina. NO corre una sesión real.
 */

import { describe, expect, it, vi } from 'vitest';
import { EventBus, Logger, ToolsRegistry } from '@proyecto-shiro/core';
import type { LoadedModules, ModuleDeps, ModulesConfig } from '@proyecto-shiro/core';
import { createApprovalGate } from '../../../src/pipeline/approval-gate.js';
import { wireSelfDev, type SelfDevEnv } from '../../../src/selfdev/wire-selfdev.js';

function deps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

function fakeModules(withToolUse: boolean): { modules: LoadedModules; registry: ToolsRegistry } {
  const registry = new ToolsRegistry({}, deps());
  const llmCloud = {
    id: 'llm:fake',
    generate: () => Promise.resolve({ text: '' }),
    ...(withToolUse ? { generateWithTools: () => Promise.resolve({ text: '' }) } : {}),
  };
  return { modules: { tools: registry, llmCloud } as unknown as LoadedModules, registry };
}

function baseOpts(modules: LoadedModules, detectEnv: (l: Logger) => Promise<SelfDevEnv>) {
  const logger = new Logger('error', { module: 'test' });
  const bus = new EventBus({ logger });
  return {
    bus,
    modules,
    config: {} as unknown as ModulesConfig, // sin bloque selfdev → defaults
    logger,
    userId: 'me',
    approvalGate: createApprovalGate(bus, logger),
    announce: vi.fn(),
    detectEnv,
  };
}

describe('wireSelfDev', () => {
  it('deshabilitado si el entorno no es apto (no repo/gh) — no registra el trigger', async () => {
    const { modules, registry } = fakeModules(true);
    const res = await wireSelfDev(
      baseOpts(modules, () =>
        Promise.resolve({ available: false, repoRoot: '', reason: 'no repo' }),
      ),
    );
    expect(res.enabled).toBe(false);
    expect(registry.get('selfdev:propose')).toBeUndefined();
  });

  it('deshabilitado si el LLM cloud no soporta tool-use', async () => {
    const { modules, registry } = fakeModules(false);
    const res = await wireSelfDev(
      baseOpts(modules, () => Promise.resolve({ available: true, repoRoot: '/fake/repo' })),
    );
    expect(res.enabled).toBe(false);
    expect(registry.get('selfdev:propose')).toBeUndefined();
  });

  it('habilitado en entorno apto + tool-use → registra selfdev:propose (confirm)', async () => {
    const { modules, registry } = fakeModules(true);
    const res = await wireSelfDev(
      baseOpts(modules, () => Promise.resolve({ available: true, repoRoot: '/fake/repo' })),
    );
    expect(res.enabled).toBe(true);
    expect(registry.get('selfdev:propose')?.permissionTier).toBe('confirm');
  });
});
