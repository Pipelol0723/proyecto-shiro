/**
 * Tests de las guardas de conexión que no cubre `connection.test.tsx`
 * (P-07a PR 2): parar el micro al perder la conexión, no quedarse en
 * 'saving' y la gracia de 1 s en la tarjeta de Setup.
 */

import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  EventBus,
  InProcessTransport,
  Logger,
  type EventMap,
  type IEventBus,
  type TransportState,
} from '@proyecto-shiro/core';
import { BusProvider } from '../../src/bus-context';
import { ConnectionProvider } from '../../src/connection/connection-context';
import { CompanionProvider } from '../../src/state/companion-context';
import { AudioProvider } from '../../src/audio/audio-context';
import { ConversationScreen } from '../../src/screens/Conversation/ConversationScreen';
import { SetupScreen } from '../../src/screens/Setup/SetupScreen';
import { useSecretsSave } from '../../src/health/useSecretsSave';

const pttMock = vi.hoisted(() => ({
  stop: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/audio/useMicrophonePTT', () => ({
  useMicrophonePTT: () => ({
    state: 'recording',
    error: null,
    start: vi.fn(() => Promise.resolve()),
    stop: pttMock.stop,
  }),
}));
vi.mock('../../src/components/Avatar', () => ({
  Avatar: () => <div data-testid="avatar" />,
}));

interface FakeSource {
  getState: () => TransportState;
  onStateChange: (h: (s: TransportState) => void) => () => void;
  set: (s: TransportState) => void;
}

function makeSource(initial: TransportState): FakeSource {
  let state = initial;
  const handlers = new Set<(s: TransportState) => void>();
  return {
    getState: () => state,
    onStateChange: (h) => {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
    set: (next) => {
      state = next;
      for (const h of [...handlers]) h(next);
    },
  };
}

function Tree({ source, children }: { source: FakeSource; children: ReactNode }): JSX.Element {
  const bus = new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
  return (
    <BusProvider bus={bus}>
      <ConnectionProvider source={source}>
        <CompanionProvider>
          <AudioProvider>{children}</AudioProvider>
        </CompanionProvider>
      </ConnectionProvider>
    </BusProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  pttMock.stop.mockClear();
});

function stubBrowser(): void {
  vi.stubGlobal('Audio', class {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    },
  );
}

describe('micro y conexión', () => {
  it('al perder la conexión con el micro grabando, para la captura', () => {
    stubBrowser();
    const source = makeSource('open');
    render(
      <Tree source={source}>
        <ConversationScreen />
      </Tree>,
    );
    expect(pttMock.stop).not.toHaveBeenCalled();
    act(() => {
      source.set('closed');
    });
    expect(pttMock.stop).toHaveBeenCalled();
  });
});

describe('useSecretsSave y pérdida de conexión', () => {
  it('si la conexión se cae mientras guarda, pasa a error en vez de quedarse en saving', () => {
    const bus = {
      on: () => () => undefined,
      emit: () => Promise.resolve(),
    } as unknown as IEventBus<EventMap>;
    const { result, rerender } = renderHook(({ c }) => useSecretsSave(bus, c), {
      initialProps: { c: true },
    });
    act(() => {
      result.current.save({ anthropic: 'k' });
    });
    expect(result.current.status).toBe('saving');
    rerender({ c: false });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/Sin conexión con el core-host/);
  });
});

describe('SetupScreen sin conexión', () => {
  it('una reconexión rápida (< 1 s) no hace aparecer la tarjeta de alerta', () => {
    vi.useFakeTimers();
    stubBrowser();
    const source = makeSource('open');
    render(
      <Tree source={source}>
        <SetupScreen />
      </Tree>,
    );
    act(() => {
      source.set('connecting');
    });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      source.set('open');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pasada la gracia sin conexión, aparece la tarjeta', () => {
    vi.useFakeTimers();
    stubBrowser();
    const source = makeSource('open');
    render(
      <Tree source={source}>
        <SetupScreen />
      </Tree>,
    );
    act(() => {
      source.set('closed');
    });
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/core-host no responde/);
  });
});
