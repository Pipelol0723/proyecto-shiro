/**
 * Tests del indicador de self-dev en el cliente: `useSelfDevStatus` (hook) y
 * `SelfDevStatus` (UI). `EventBus` real + `BusProvider`; simulamos los
 * `selfdev:progress`/`selfdev:done` que manda el core-host.
 */

import { render, renderHook, act, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { EventBus, InProcessTransport, Logger, type EventMap } from '@proyecto-shiro/core';
import { BusProvider } from '../../src/bus-context';
import { SelfDevStatus, useSelfDevStatus } from '../../src/components/SelfDev';

function makeBus(): EventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error'),
    transports: [new InProcessTransport()],
  });
}

function wrapper(bus: EventBus<EventMap>) {
  return ({ children }: { children: ReactNode }) => <BusProvider bus={bus}>{children}</BusProvider>;
}

const PROGRESS: EventMap['selfdev:progress'] = {
  sessionId: 's1',
  topic: 'arreglar el lip-sync',
  phase: 'generating',
};
const DONE_OK: EventMap['selfdev:done'] = {
  sessionId: 's1',
  topic: 'arreglar el lip-sync',
  ok: true,
  prUrl: 'https://github.com/o/r/pull/42',
  branch: 'shiro/arreglar-el-lip-sync',
};
const DONE_FAIL: EventMap['selfdev:done'] = {
  sessionId: 's1',
  topic: 'cambio imposible',
  ok: false,
  branch: 'shiro/cambio-imposible',
  reason: 'el eval no pasó tras 2 reintentos',
};

describe('useSelfDevStatus', () => {
  it('expone la sesión al recibir selfdev:progress', async () => {
    const bus = makeBus();
    const { result } = renderHook(() => useSelfDevStatus(), { wrapper: wrapper(bus) });
    expect(result.current.session).toBeNull();

    await act(async () => {
      await bus.emit('selfdev:progress', PROGRESS);
    });

    expect(result.current.session).toMatchObject({
      topic: 'arreglar el lip-sync',
      phase: 'generating',
    });
    expect(result.current.result).toBeNull();
  });

  it('selfdev:done pasa de sesión a resultado', async () => {
    const bus = makeBus();
    const { result } = renderHook(() => useSelfDevStatus(), { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('selfdev:progress', PROGRESS);
    });
    await act(async () => {
      await bus.emit('selfdev:done', DONE_OK);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.result).toMatchObject({
      ok: true,
      prUrl: 'https://github.com/o/r/pull/42',
    });
  });

  it('dismiss limpia el resultado', async () => {
    const bus = makeBus();
    const { result } = renderHook(() => useSelfDevStatus(), { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('selfdev:done', DONE_OK);
    });
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.result).toBeNull();
  });
});

describe('SelfDevStatus', () => {
  it('no renderiza nada sin sesión ni resultado', () => {
    const bus = makeBus();
    const { container } = render(<SelfDevStatus />, { wrapper: wrapper(bus) });
    expect(container.firstChild).toBeNull();
  });

  it('muestra el topic y la fase durante la sesión', async () => {
    const bus = makeBus();
    render(<SelfDevStatus />, { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('selfdev:progress', PROGRESS);
    });

    expect(screen.getByText(/arreglar el lip-sync/)).toBeDefined();
    expect(screen.getByText(/generando/)).toBeDefined();
  });

  it('al terminar con éxito muestra el link del PR', async () => {
    const bus = makeBus();
    render(<SelfDevStatus />, { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('selfdev:done', DONE_OK);
    });

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/42');
  });

  it('al fallar muestra el motivo y se puede cerrar', async () => {
    const bus = makeBus();
    const { container } = render(<SelfDevStatus />, { wrapper: wrapper(bus) });

    await act(async () => {
      await bus.emit('selfdev:done', DONE_FAIL);
    });
    expect(screen.getByText(/el eval no pasó/)).toBeDefined();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    });
    expect(container.firstChild).toBeNull();
  });
});
