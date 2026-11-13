/**
 * Decisión del dueño (2026-11-13): si la conexión se cae mientras Shiro habla,
 * la voz se corta en local y el usuario ve un aviso claro. El aviso no sale si
 * no había voz sonando (para eso ya está el banner) y dura hasta el turno
 * siguiente.
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

const NOTICE = 'Hay un problema con la conexión: se cortó lo que Shiro estaba diciendo.';

// Como el navegador: asignar una cadena vacía a un audio con fuente dispara `error`.
class FakeAudio {
  static instances: FakeAudio[] = [];
  crossOrigin: string | null = null;
  paused = true;
  private srcValue = '';
  private listeners = new Map<string, (() => void)[]>();
  constructor() {
    FakeAudio.instances.push(this);
  }
  get src(): string {
    return this.srcValue;
  }
  set src(value: string) {
    const hadSource = this.srcValue !== '';
    this.srcValue = value;
    if (value === '' && hadSource) this.trigger('error');
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(event: string, listener: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  trigger(event: 'ended' | 'error'): void {
    for (const l of this.listeners.get(event) ?? []) l();
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

function setup(): {
  bus: EventBus<EventMap>;
  source: ReturnType<typeof makeSource>;
  ended: ReturnType<typeof vi.fn>;
  speak: () => Promise<FakeAudio | undefined>;
} {
  const bus = new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
  const source = makeSource('open');
  const ended = vi.fn();
  bus.on('tts:audio-ended', ended);
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
  const speak = async (): Promise<FakeAudio | undefined> => {
    await act(async () => {
      await bus.emit('llm:responded', {
        text: 'hola',
        emotion: 'neutral',
        tier: 'local',
        latencyMs: 5,
      } as EventMap['llm:responded']);
      await bus.emit('tts:audio', {
        url: 'http://x/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });
    return FakeAudio.instances.at(-1);
  };
  return { bus, source, ended, speak };
}

describe('caída de conexión mientras Shiro habla', () => {
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

  it('corta el audio al perder la conexión y «Hablando…» desaparece', async () => {
    const { source, speak } = setup();
    const audio = await speak();
    expect(audio?.paused).toBe(false);
    expect(screen.getByText('Hablando…')).toBeTruthy();

    act(() => {
      source.set('closed');
    });

    expect(audio?.paused).toBe(true);
    expect(audio?.src).toBe('');
    expect(screen.queryByText('Hablando…')).toBeNull();
  });

  it('muestra el aviso tras el corte, y no si no había audio sonando', async () => {
    const { source, speak } = setup();
    // Sin audio: la conexión cae y no hay aviso.
    act(() => {
      source.set('closed');
    });
    expect(screen.queryByText(NOTICE)).toBeNull();
    act(() => {
      source.set('open');
    });

    await speak();
    act(() => {
      source.set('closed');
    });
    const notice = screen.getByText(NOTICE);
    expect(notice.getAttribute('role')).toBe('status');
  });

  it('el aviso sigue al reconectar y se va al enviar un mensaje', async () => {
    const { source, speak } = setup();
    await speak();
    act(() => {
      source.set('closed');
    });
    act(() => {
      source.set('open');
    });
    expect(screen.getByText(NOTICE)).toBeTruthy();

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hola' } });
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
      await Promise.resolve();
    });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('el aviso se va cuando llega una respuesta nueva de Shiro', async () => {
    const { bus, source, speak } = setup();
    await speak();
    act(() => {
      source.set('closed');
    });
    act(() => {
      source.set('open');
    });
    expect(screen.getByText(NOTICE)).toBeTruthy();

    await act(async () => {
      await bus.emit('llm:responded', {
        text: 'otra',
        emotion: 'neutral',
        tier: 'local',
        latencyMs: 5,
      } as EventMap['llm:responded']);
    });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('el aviso se va cuando el usuario empieza a hablar', async () => {
    const { bus, source, speak } = setup();
    await speak();
    act(() => {
      source.set('closed');
    });
    act(() => {
      source.set('open');
    });
    await act(async () => {
      await bus.emit('stt:listening', { userId: 'me' });
    });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('el corte no emite tts:audio-ended ni vuelve a cortar al reconectar', async () => {
    const { source, ended, speak } = setup();
    const audio = await speak();
    act(() => {
      source.set('closed');
    });
    // El `error` que dispara `src = ''` no cuenta como fin de audio.
    expect(ended).not.toHaveBeenCalled();
    act(() => {
      audio?.trigger('ended');
      source.set('open');
    });
    expect(ended).not.toHaveBeenCalled();
    expect(FakeAudio.instances).toHaveLength(1);
  });
});
