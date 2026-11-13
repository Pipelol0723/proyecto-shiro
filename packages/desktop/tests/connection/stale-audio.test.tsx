/**
 * Una pérdida de conexión corta en local el audio TTS que suena (decisión del
 * dueño, 2026-11-13); el corte y su aviso se prueban en voice-cut.test.tsx.
 * Aquí se comprueba que, recuperada la conexión, enviar un mensaje con el
 * audio ya cortado sigue funcionando y no reinicia la voz vieja.
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

  it('tras una pérdida de conexión el audio queda cortado y enviar un mensaje no lo reinicia', async () => {
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

    // Pérdida y recuperación: el audio se corta en la pérdida.
    act(() => {
      source.set('closed');
    });
    expect(audio?.paused).toBe(true);
    act(() => {
      source.set('open');
    });
    expect(audio?.paused).toBe(true);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hola' } });
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
      await Promise.resolve();
    });

    expect(audio?.paused).toBe(true);
  });
});
