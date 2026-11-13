/**
 * Un audio TTS ya recibido sigue sonando tras una pérdida de conexión aunque
 * `speaking` se apague. Enviar un mensaje debe cortarlo igualmente para que
 * la frase vieja no se solape con la respuesta nueva.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventBus,
  InProcessTransport,
  Logger,
  type EventMap,
  type TransportState,
} from '@proyecto-shiro/core';
import { BusProvider } from '../../src/bus-context';
import { ConnectionProvider } from '../../src/connection/connection-context';
import { CompanionProvider } from '../../src/state/companion-context';
import { AudioProvider } from '../../src/audio/audio-context';
import { ConversationScreen } from '../../src/screens/Conversation/ConversationScreen';

vi.mock('../../src/components/Avatar', () => ({
  Avatar: () => <div data-testid="avatar" />,
}));

class FakeAudio {
  static instances: FakeAudio[] = [];
  crossOrigin: string | null = null;
  paused = true;
  src = '';
  constructor() {
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(): void {
    // sin eventos en este test
  }
}

function makeSource(initial: TransportState): {
  getState: () => TransportState;
  onStateChange: (h: (s: TransportState) => void) => () => void;
  set: (s: TransportState) => void;
} {
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

describe('audio TTS que sobrevive a una pérdida de conexión', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enviar un mensaje tras recuperar la conexión corta el audio que sigue sonando', async () => {
    const bus = new EventBus<EventMap>({
      logger: new Logger('error', { module: 'test' }),
      transports: [new InProcessTransport()],
    });
    const source = makeSource('open');
    render(
      <BusProvider bus={bus}>
        <ConnectionProvider source={source}>
          <CompanionProvider>
            <AudioProvider>
              <ConversationScreen />
            </AudioProvider>
          </CompanionProvider>
        </ConnectionProvider>
      </BusProvider>,
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: 'http://x/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });
    const audio = FakeAudio.instances[0];
    expect(audio?.paused).toBe(false);

    // Pérdida y recuperación: el reducer apaga `speaking`, el audio sigue.
    act(() => {
      source.set('closed');
    });
    act(() => {
      source.set('open');
    });
    expect(audio?.paused).toBe(false);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hola' } });
    await act(async () => {
      fireEvent.submit(input.closest('form') as HTMLFormElement);
      await Promise.resolve();
    });

    expect(audio?.paused).toBe(true);
  });
});
