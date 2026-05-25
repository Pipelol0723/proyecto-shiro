import { describe, it, expect, vi } from 'vitest';
import { InProcessTransport } from '../../../../src/core/transports/in-process-transport.js';

describe('InProcessTransport', () => {
  it('id es "in-process"', () => {
    const t = new InProcessTransport();
    expect(t.id).toBe('in-process');
  });

  it('send es no-op y resuelve sin error', async () => {
    const t = new InProcessTransport();
    await expect(t.send('foo:bar', { value: 1 })).resolves.toBeUndefined();
  });

  it('onReceive registra un handler que simulateReceive invoca', async () => {
    const t = new InProcessTransport();
    const handler = vi.fn();
    t.onReceive(handler);
    await t.simulateReceive('foo:bar', { value: 42 });
    expect(handler).toHaveBeenCalledWith('foo:bar', { value: 42 });
  });

  it('segundo onReceive reemplaza al primero', async () => {
    const t = new InProcessTransport();
    const h1 = vi.fn();
    const h2 = vi.fn();
    t.onReceive(h1);
    t.onReceive(h2);
    await t.simulateReceive('foo', null);
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('simulateReceive sin handler resuelve silenciosamente', async () => {
    const t = new InProcessTransport();
    await expect(t.simulateReceive('foo', null)).resolves.toBeUndefined();
  });

  it('close() impide recepciones posteriores', async () => {
    const t = new InProcessTransport();
    const handler = vi.fn();
    t.onReceive(handler);
    await t.close();
    await t.simulateReceive('foo', null);
    expect(handler).not.toHaveBeenCalled();
  });
});
