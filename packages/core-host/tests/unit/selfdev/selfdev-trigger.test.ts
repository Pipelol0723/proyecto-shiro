/**
 * Tests de `selfdev:propose`: valida args, delega en `onPropose` (que arranca
 * la sesión) y refleja la decisión (aceptada / rechazada por ocupada) en el ack.
 */

import { describe, expect, it, vi } from 'vitest';
import { EventBus, Logger, ToolsRegistry } from '@proyecto-shiro/core';
import type { ModuleDeps, ToolContext } from '@proyecto-shiro/core';
import {
  SelfDevProposeTool,
  registerSelfDevTrigger,
  type SelfDevProposeHandler,
} from '../../../src/selfdev/selfdev-trigger.js';

function ctx(): ToolContext {
  return { logger: new Logger('error', { module: 'test' }), userId: 'me' };
}

function deps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

describe('SelfDevProposeTool', () => {
  it('es tier confirm y se llama selfdev:propose', () => {
    const tool = new SelfDevProposeTool(() => ({ accepted: true }));
    expect(tool.id).toBe('selfdev:propose');
    expect(tool.name).toBe('selfdev_propose');
    expect(tool.permissionTier).toBe('confirm');
  });

  it('con args válidos arranca la sesión y devuelve ok con el topic', async () => {
    const onPropose = vi.fn<SelfDevProposeHandler>(() => ({ accepted: true }));
    const res = await new SelfDevProposeTool(onPropose).execute(
      { topic: 'arreglar lip-sync', summary: 'la boca no se mueve si el TTS falla' },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(onPropose).toHaveBeenCalledWith(
      'arreglar lip-sync',
      'la boca no se mueve si el TTS falla',
    );
    expect((res.data as { topic: string }).topic).toBe('arreglar lip-sync');
  });

  it('si onPropose rechaza (sesión ocupada) devuelve ok:false con el motivo', async () => {
    const onPropose: SelfDevProposeHandler = () => ({
      accepted: false,
      reason: 'ya hay una sesión de self-dev en curso',
    });
    const res = await new SelfDevProposeTool(onPropose).execute({ topic: 'otra cosa' }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('en curso');
  });

  it('rechaza args inválidos (topic vacío) sin llamar onPropose', async () => {
    const onPropose = vi.fn<SelfDevProposeHandler>(() => ({ accepted: true }));
    const res = await new SelfDevProposeTool(onPropose).execute({ topic: '' }, ctx());
    expect(res.ok).toBe(false);
    expect(res.error).toContain('inválidos');
    expect(onPropose).not.toHaveBeenCalled();
  });
});

describe('registerSelfDevTrigger', () => {
  it('registra la tool en el registry', () => {
    const registry = new ToolsRegistry({}, deps());
    registerSelfDevTrigger(registry, { onPropose: () => ({ accepted: true }) });
    expect(registry.get('selfdev:propose')?.permissionTier).toBe('confirm');
  });
});
