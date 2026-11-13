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
    // self-dev está apagado por defecto (P-01): los casos que ejercitan el resto
    // de la lógica de habilitación lo encienden aquí; los de «apagado» lo pisan.
    config: { selfdev: { enabled: true } } as unknown as ModulesConfig,
    logger,
    userId: 'me',
    approvalGate: createApprovalGate(bus, logger),
    announce: vi.fn(),
    detectEnv,
  };
}

describe('wireSelfDev', () => {
  it('deshabilitado por defecto: sin selfdev.enabled no llama a detectEnv ni registra el trigger', async () => {
    const { modules, registry } = fakeModules(true);
    const detectEnv = vi.fn(() => Promise.resolve({ available: true, repoRoot: '/fake/repo' }));
    const res = await wireSelfDev({
      ...baseOpts(modules, detectEnv),
      config: {} as unknown as ModulesConfig,
    });
    expect(res.enabled).toBe(false);
    expect(detectEnv).not.toHaveBeenCalled();
    expect(registry.get('selfdev:propose')).toBeUndefined();
  });

  it('deshabilitado con selfdev.enabled=false explícito', async () => {
    const { modules, registry } = fakeModules(true);
    const detectEnv = vi.fn(() => Promise.resolve({ available: true, repoRoot: '/fake/repo' }));
    const res = await wireSelfDev({
      ...baseOpts(modules, detectEnv),
      config: { selfdev: { enabled: false } } as unknown as ModulesConfig,
    });
    expect(res.enabled).toBe(false);
    expect(detectEnv).not.toHaveBeenCalled();
    expect(registry.get('selfdev:propose')).toBeUndefined();
  });

  it('deshabilitado si el entorno no es apto (no repo/gh) — no registra el trigger', async () => {
    const { modules, registry } = fakeModules(true);
    const detectEnv = vi.fn(() =>
      Promise.resolve({ available: false, repoRoot: '', reason: 'no repo' }),
    );
    const res = await wireSelfDev(baseOpts(modules, detectEnv));
    expect(res.enabled).toBe(false);
    expect(detectEnv).toHaveBeenCalledOnce();
    expect(registry.get('selfdev:propose')).toBeUndefined();
  });

  it('un selfdev.enabled que no es el booleano true (p. ej. "true") cuenta como apagado', async () => {
    const { modules, registry } = fakeModules(true);
    const detectEnv = vi.fn(() => Promise.resolve({ available: true, repoRoot: '/fake/repo' }));
    const res = await wireSelfDev({
      ...baseOpts(modules, detectEnv),
      config: { selfdev: { enabled: 'true' } } as unknown as ModulesConfig,
    });
    expect(res.enabled).toBe(false);
    expect(detectEnv).not.toHaveBeenCalled();
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
