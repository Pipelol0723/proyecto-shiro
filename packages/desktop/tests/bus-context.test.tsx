/**
 * Tests del BusProvider + useBus + useBusEvent.
 *
 * Estrategia: usar el `EventBus` real (no mockear el core). Los tests
 * verifican que la maquinaria React (provider, context, hook) se
 * cablea correctamente.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EventBus, InProcessTransport, Logger, type EventMap } from '@proyecto-shiro/core';
import { BusProvider } from '../src/bus-context';
import { useBus, useBusEvent } from '../src/use-bus';

/** Bus silencioso (level 'error') con InProcessTransport para tests. */
function makeBus(): EventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error'),
    transports: [new InProcessTransport()],
  });
}

function wrapper(bus?: EventBus<EventMap>) {
  return ({ children }: { children: ReactNode }) => <BusProvider bus={bus}>{children}</BusProvider>;
}

describe('useBus', () => {
  it('devuelve la instancia del bus del provider', () => {
    const bus = makeBus();
    const { result } = renderHook(() => useBus(), { wrapper: wrapper(bus) });
    expect(result.current).toBe(bus);
  });

  it('lanza si se usa fuera del BusProvider', () => {
    // Silenciamos el error de React que renderHook propaga a console.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useBus())).toThrow(
      /useBus\(\) debe usarse dentro de <BusProvider>/,
    );
    consoleError.mockRestore();
  });

  it('construye un bus por defecto si no se pasa uno', () => {
    const { result } = renderHook(() => useBus(), { wrapper: wrapper() });
    expect(result.current).toBeDefined();
    expect(typeof result.current.emit).toBe('function');
  });
});

describe('useBusEvent', () => {
  it('llama al handler cuando el bus emite el evento suscrito', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    renderHook(() => useBusEvent('bus:ready', handler), { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('bus:ready', { startedAt: '2026-05-27T00:00:00Z' });
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ startedAt: '2026-05-27T00:00:00Z' });
  });

  it('no llama al handler tras desmontar (cleanup)', async () => {
    const bus = makeBus();
    const handler = vi.fn();
    const { unmount } = renderHook(() => useBusEvent('bus:ready', handler), {
      wrapper: wrapper(bus),
    });

    unmount();

    await act(async () => {
      await bus.emit('bus:ready', { startedAt: 'after-unmount' });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('usa la última versión del handler (ref pattern)', async () => {
    const bus = makeBus();
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ h }: { h: (p: EventMap['bus:ready']) => void }) => useBusEvent('bus:ready', h),
      {
        wrapper: wrapper(bus),
        initialProps: { h: first },
      },
    );

    rerender({ h: second });

    await act(async () => {
      await bus.emit('bus:ready', { startedAt: 't' });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('BusProvider sin bus injectado construye uno funcional', () => {
    const { container } = render(
      <BusProvider>
        <div>hola</div>
      </BusProvider>,
    );
    expect(container.textContent).toBe('hola');
  });
});
