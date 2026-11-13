/**
 * Tests del estado de conexión visible (P-07a PR 2; L-BUG-10 y L-PROD-05,
 * R-068, R-082, R-118, R-120, R-298).
 *
 * El `source` es un transport falso con `set(state)`: el cliente real usa
 * `WebSocketTransport`, que cumple el mismo contrato (`IObservableTransport`).
 */

import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  EventBus,
  InProcessTransport,
  Logger,
  WebSocketTransport,
  type EventMap,
  type IEventBus,
  type TransportState,
} from '@proyecto-shiro/core';
import { BusProvider } from '../../src/bus-context';
import { ConnectionProvider } from '../../src/connection/connection-context';
import { useConnectionState } from '../../src/connection/use-connection';
import { ConnectionBanner } from '../../src/connection/ConnectionBanner';
import { CompanionProvider } from '../../src/state/companion-context';
import { AudioProvider } from '../../src/audio/audio-context';
import { ConversationScreen } from '../../src/screens/Conversation/ConversationScreen';

vi.mock('../../src/components/Avatar', () => ({
  Avatar: () => <div data-testid="avatar" />,
}));

interface FakeSource {
  getState: () => TransportState;
  onStateChange: (handler: (state: TransportState) => void) => () => void;
  set: (state: TransportState) => void;
}

function makeSource(initial: TransportState): FakeSource {
  let state = initial;
  const handlers = new Set<(s: TransportState) => void>();
  return {
    getState: () => state,
    onStateChange: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    set: (next) => {
      state = next;
      for (const h of [...handlers]) h(next);
    },
  };
}

function makeBus(): IEventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
}

function Tree({
  bus,
  source,
  children,
}: {
  bus: IEventBus<EventMap>;
  source?: FakeSource;
  children: ReactNode;
}): JSX.Element {
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

beforeEach(() => {
  vi.stubGlobal('Audio', class {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    },
  );
  // Micro "soportado" para que el botón no esté deshabilitado por otra causa.
  vi.stubGlobal('AudioContext', class {});
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('ConnectionProvider', () => {
  it('sin source el estado es open', () => {
    const { result } = renderHook(() => useConnectionState(), {
      wrapper: ({ children }) => <ConnectionProvider>{children}</ConnectionProvider>,
    });
    expect(result.current).toBe('open');
  });

  it('sigue los cambios del source', () => {
    const source = makeSource('connecting');
    const { result } = renderHook(() => useConnectionState(), {
      wrapper: ({ children }) => (
        <ConnectionProvider source={source}>{children}</ConnectionProvider>
      ),
    });
    expect(result.current).toBe('connecting');
    act(() => {
      source.set('open');
    });
    expect(result.current).toBe('open');
  });
});

describe('ConnectionProvider con WebSocketTransport real', () => {
  it('lee el estado de un transport real sin perder el receptor (this)', () => {
    class FakeSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      send(): void {}
      close(): void {}
    }
    const transport = new WebSocketTransport({
      url: 'ws://localhost:0/bus',
      logger: new Logger('error', { module: 'test' }),
      webSocketCtor: FakeSocket as unknown as NonNullable<
        ConstructorParameters<typeof WebSocketTransport>[0]['webSocketCtor']
      >,
      autoConnect: false,
    });
    const { result } = renderHook(() => useConnectionState(), {
      wrapper: ({ children }) => (
        <ConnectionProvider source={transport}>{children}</ConnectionProvider>
      ),
    });
    expect(result.current).toBe('closed');
  });
});

describe('ConnectionBanner', () => {
  it('muestra el banner tras 1 s sin conexión y lo quita al reconectar', () => {
    vi.useFakeTimers();
    const source = makeSource('open');
    render(
      <ConnectionProvider source={source}>
        <ConnectionBanner />
      </ConnectionProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      source.set('closed');
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('status').textContent).toMatch(/Sin conexión con Shiro/);

    act(() => {
      source.set('open');
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('una reconexión rápida (< 1 s) no hace parpadear el banner', () => {
    vi.useFakeTimers();
    const source = makeSource('open');
    render(
      <ConnectionProvider source={source}>
        <ConnectionBanner />
      </ConnectionProvider>,
    );
    act(() => {
      source.set('connecting');
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      source.set('open');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('ConversationScreen sin conexión', () => {
  it('deshabilita el input de texto, el botón de enviar y el micro sin conexión', () => {
    const source = makeSource('open');
    render(
      <Tree bus={makeBus()} source={source}>
        <ConversationScreen />
      </Tree>,
    );
    const mic = (): HTMLButtonElement => {
      const el = document.querySelector('button[aria-pressed]:not([aria-label^="Audio"])');
      if (el === null) throw new Error('micro no encontrado');
      return el as HTMLButtonElement;
    };
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', false);
    expect(mic().disabled).toBe(false);

    act(() => {
      source.set('closed');
    });

    const input = screen.getByRole('textbox');
    expect(input).toHaveProperty('disabled', true);
    expect(input.getAttribute('placeholder')).toMatch(/Sin conexión con Shiro/);
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', true);
    expect(mic().disabled).toBe(true);
  });

  it('al perder la conexión thinking, listening y speaking vuelven a false en ≤ 3 s', async () => {
    const bus = makeBus();
    const source = makeSource('open');
    render(
      <Tree bus={bus} source={source}>
        <ConversationScreen />
      </Tree>,
    );
    await act(async () => {
      await bus.emit('router:routed', { tier: 'local' } as EventMap['router:routed']);
      await bus.emit('stt:listening', {} as EventMap['stt:listening']);
    });
    expect(screen.getByText(/Pensando/)).toBeDefined();
    expect(screen.getByText(/Escuchando/)).toBeDefined();
    await act(async () => {
      await bus.emit('llm:responded', {
        text: 'hola',
        emotion: 'neutral',
        tier: 'local',
        latencyMs: 1,
      } as EventMap['llm:responded']);
    });
    expect(screen.getByText(/Hablando/)).toBeDefined();

    act(() => {
      source.set('closed');
    });

    expect(screen.queryByText(/Pensando/)).toBeNull();
    expect(screen.queryByText(/Escuchando/)).toBeNull();
    expect(screen.queryByText(/Hablando/)).toBeNull();
  });
});
