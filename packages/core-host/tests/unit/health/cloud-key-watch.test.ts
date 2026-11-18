/**
 * Tests de cloud-key-watch: recuerda si la nube rechazó la clave o se quedó
 * sin cuota, a partir de los eventos del turno (`llm:failed`, `llm:responded`).
 */

import { describe, expect, it, vi } from 'vitest';
import { EventBus, Logger, type EventMap } from '@proyecto-shiro/core';
import { watchCloudKey } from '../../../src/health/cloud-key-watch.js';

function setup(): {
  bus: EventBus<EventMap>;
  onChange: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof watchCloudKey>;
} {
  const bus = new EventBus<EventMap>({ logger: new Logger('error', { module: 'test' }) });
  const onChange = vi.fn();
  const watch = watchCloudKey(bus, onChange);
  return { bus, onChange, watch };
}

const cloudReply: EventMap['llm:responded'] = {
  text: 'hola',
  emotion: 'neutral',
  userId: 'me',
  tier: 'cloud',
  latencyMs: 10,
};

describe('watchCloudKey', () => {
  it('empieza sin problema', () => {
    expect(setup().watch.current()).toBeUndefined();
  });

  it.each(['auth', 'quota'] as const)(
    'un fallo «%s» de la nube queda anotado y avisa',
    async (reason) => {
      const { bus, onChange, watch } = setup();

      await bus.emit('llm:failed', { reason, tier: 'cloud', userId: 'me' });

      expect(watch.current()).toBe(reason);
      expect(onChange).toHaveBeenCalledTimes(1);
    },
  );

  it('un fallo del modelo local no dice nada de la clave de la nube', async () => {
    const { bus, onChange, watch } = setup();

    await bus.emit('llm:failed', { reason: 'auth', tier: 'local', userId: 'me' });

    expect(watch.current()).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('otros fallos de la nube ni anotan ni borran: no dicen nada de la clave', async () => {
    const { bus, onChange, watch } = setup();

    await bus.emit('llm:failed', { reason: 'unavailable', tier: 'cloud', userId: 'me' });
    expect(watch.current()).toBeUndefined();

    await bus.emit('llm:failed', { reason: 'auth', tier: 'cloud', userId: 'me' });
    await bus.emit('llm:failed', { reason: 'unavailable', tier: 'cloud', userId: 'me' });
    expect(watch.current()).toBe('auth');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('el mismo problema repetido no vuelve a avisar', async () => {
    const { bus, onChange } = setup();

    await bus.emit('llm:failed', { reason: 'quota', tier: 'cloud', userId: 'me' });
    await bus.emit('llm:failed', { reason: 'quota', tier: 'cloud', userId: 'me' });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('una respuesta de un turno enrutado a la nube borra el problema y avisa', async () => {
    const { bus, onChange, watch } = setup();
    await bus.emit('llm:failed', { reason: 'auth', tier: 'cloud', userId: 'me' });

    await bus.emit('router:routed', { tier: 'cloud', userId: 'me' });
    await bus.emit('llm:responded', cloudReply);

    expect(watch.current()).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('una respuesta «de la nube» sin turno no lo borra: el reporte de self-dev no llama a la nube', async () => {
    const { bus, onChange, watch } = setup();
    await bus.emit('llm:failed', { reason: 'auth', tier: 'cloud', userId: 'me' });

    await bus.emit('llm:responded', { ...cloudReply, latencyMs: 0 });

    expect(watch.current()).toBe('auth');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('un turno de la nube que falla y sigue en local no cuenta como respuesta de la nube', async () => {
    const { bus, watch } = setup();
    await bus.emit('llm:failed', { reason: 'quota', tier: 'cloud', userId: 'me' });

    await bus.emit('router:routed', { tier: 'cloud', userId: 'me' });
    await bus.emit('llm:failed', { reason: 'unavailable', tier: 'cloud', userId: 'me' });
    await bus.emit('llm:responded', cloudReply);

    expect(watch.current()).toBe('quota');
  });

  it('una respuesta del modelo local no lo borra', async () => {
    const { bus, watch } = setup();
    await bus.emit('llm:failed', { reason: 'auth', tier: 'cloud', userId: 'me' });

    await bus.emit('llm:responded', { ...cloudReply, tier: 'local' });

    expect(watch.current()).toBe('auth');
  });

  it('una respuesta de la nube sin problema anotado no avisa', async () => {
    const { bus, onChange } = setup();

    await bus.emit('llm:responded', cloudReply);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('dispose deja de escuchar', async () => {
    const { bus, onChange, watch } = setup();
    watch.dispose();

    await bus.emit('llm:failed', { reason: 'auth', tier: 'cloud', userId: 'me' });

    expect(watch.current()).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
  });
});
