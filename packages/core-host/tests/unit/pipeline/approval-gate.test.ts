/**
 * Tests del `ApprovalGate`: correlación por `requestId`, timeout, e
 * indiferencia ante respuestas que no casan.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import { createApprovalGate } from '../../../src/pipeline/approval-gate.js';

function makeBus(): IEventBus<EventMap> {
  return new EventBus({ logger: new Logger('error') });
}

const req = { toolId: 'fs:write', toolName: 'fs_write', argsPreview: '{}', userId: 'me' };

/** Espera al `tool:requires-approval` que emite el gate y devuelve su requestId. */
function captureRequestId(bus: IEventBus<EventMap>): Promise<string> {
  return new Promise<string>((resolve) => {
    bus.on('tool:requires-approval', (p) => {
      resolve(p.requestId);
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createApprovalGate', () => {
  it('emite tool:requires-approval con los datos de la tool', async () => {
    const bus = makeBus();
    const gate = createApprovalGate(bus, new Logger('error'));
    const received = new Promise<EventMap['tool:requires-approval']>((resolve) => {
      bus.on('tool:requires-approval', resolve);
    });

    void gate.requestApproval(req);
    const event = await received;

    expect(event).toMatchObject({ toolId: 'fs:write', toolName: 'fs_write', userId: 'me' });
    expect(event.requestId).toBeTruthy();
    gate.dispose();
  });

  it('resuelve true cuando llega tool:approval con el requestId correcto', async () => {
    const bus = makeBus();
    const gate = createApprovalGate(bus, new Logger('error'));
    const captured = captureRequestId(bus);

    const decision = gate.requestApproval(req);
    const requestId = await captured;
    await bus.emit('tool:approval', { requestId, approved: true, userId: 'me' });

    await expect(decision).resolves.toBe(true);
    gate.dispose();
  });

  it('resuelve false cuando el usuario rechaza', async () => {
    const bus = makeBus();
    const gate = createApprovalGate(bus, new Logger('error'));
    const captured = captureRequestId(bus);

    const decision = gate.requestApproval(req);
    const requestId = await captured;
    await bus.emit('tool:approval', { requestId, approved: false, userId: 'me' });

    await expect(decision).resolves.toBe(false);
    gate.dispose();
  });

  it('ignora un tool:approval con requestId que no casa', async () => {
    const bus = makeBus();
    const gate = createApprovalGate(bus, new Logger('error'));
    const captured = captureRequestId(bus);

    const decision = gate.requestApproval(req);
    const requestId = await captured;
    // Respuesta de otra petición: no debe resolver la nuestra.
    await bus.emit('tool:approval', { requestId: 'otro-id', approved: true, userId: 'me' });
    // La respuesta correcta sí la resuelve.
    await bus.emit('tool:approval', { requestId, approved: false, userId: 'me' });

    await expect(decision).resolves.toBe(false);
    gate.dispose();
  });

  it('resuelve false por timeout si nadie responde', async () => {
    vi.useFakeTimers();
    const bus = makeBus();
    const gate = createApprovalGate(bus, new Logger('error'), { timeoutMs: 1_000 });

    const decision = gate.requestApproval(req);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(decision).resolves.toBe(false);
    gate.dispose();
  });

  it('dispose resuelve las pendientes como false', async () => {
    const bus = makeBus();
    const gate = createApprovalGate(bus, new Logger('error'));

    const decision = gate.requestApproval(req);
    gate.dispose();

    await expect(decision).resolves.toBe(false);
  });
});
