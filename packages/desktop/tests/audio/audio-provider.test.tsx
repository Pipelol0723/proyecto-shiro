/**
 * Tests del audio global (P-07b, R-058 y R-119): la voz de Shiro no debe
 * cortarse al cambiar de pantalla y debe sonar aunque la respuesta llegue
 * con otra pantalla montada.
 *
 * `Audio` se sustituye con `vi.stubGlobal` para que el test valga igual
 * antes y después de introducir `AudioProvider`. El harness lo monta si el
 * módulo existe (`import.meta.glob`), de modo que la versión «roja» se
 * ejecuta contra el árbol anterior (BusProvider + CompanionProvider).
 */

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import {
  EventBus,
  InProcessTransport,
  Logger,
  type EventMap,
  type IEventBus,
} from '@proyecto-shiro/core';
import { BusProvider } from '../../src/bus-context';
import { CompanionProvider } from '../../src/state/companion-context';
import { ConversationScreen } from '../../src/screens/Conversation/ConversationScreen';

vi.mock('../../src/components/Avatar', () => ({
  Avatar: () => <div data-testid="avatar" />,
}));

interface AudioModule {
  AudioProvider: (props: { children: ReactNode }) => JSX.Element;
}
interface UseAudioModule {
  useAudio: () => unknown;
}
const audioModules = import.meta.glob<AudioModule>('../../src/audio/audio-context.tsx', {
  eager: true,
});
const useAudioModules = import.meta.glob<UseAudioModule>('../../src/audio/use-audio.ts', {
  eager: true,
});
const AudioProvider = Object.values(audioModules)[0]?.AudioProvider;
const useAudio = Object.values(useAudioModules)[0]?.useAudio;

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
  // Como el navegador: asignar '' a un audio con fuente dispara `error`.
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

function makeBus(): IEventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
}

let showChat: (value: boolean) => void = () => undefined;

function Harness({ bus }: { bus: IEventBus<EventMap> }): JSX.Element {
  const [chat, setChat] = useState(true);
  showChat = setChat;
  const screens = chat ? <ConversationScreen /> : <p>otra pantalla</p>;
  return (
    <BusProvider bus={bus}>
      <CompanionProvider>
        {AudioProvider ? <AudioProvider>{screens}</AudioProvider> : screens}
      </CompanionProvider>
    </BusProvider>
  );
}

const AUDIO = { url: 'http://x/a.mp3', audioId: 'a', mimeType: 'audio/mpeg', userId: 'me' };

describe('AudioProvider', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    window.localStorage.removeItem('shiro:tts:muted');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('desmontar ConversationScreen no corta el audio ni emite tts:audio-ended', async () => {
    const bus = makeBus();
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });
    render(<Harness bus={bus} />);

    await act(async () => {
      await bus.emit('tts:audio', AUDIO);
    });
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0]?.paused).toBe(false);

    act(() => {
      showChat(false);
    });
    expect(screen.getByText('otra pantalla')).toBeDefined();

    expect(FakeAudio.instances[0]?.paused).toBe(false);
    expect(ended).toHaveLength(0);
  });

  it('un tts:audio que llega con otra pantalla montada suena y emite tts:audio-ended al terminar', async () => {
    const bus = makeBus();
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });
    render(<Harness bus={bus} />);
    act(() => {
      showChat(false);
    });

    await act(async () => {
      await bus.emit('tts:audio', AUDIO);
    });
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0]?.paused).toBe(false);

    act(() => {
      FakeAudio.instances[0]?.trigger('ended');
    });
    await waitFor(() => {
      expect(ended).toEqual([{ userId: 'me', audioId: 'a' }]);
    });
  });

  it('useAudio fuera de AudioProvider lanza un error claro', () => {
    expect(useAudio).toBeDefined();
    expect(() => renderHook(() => useAudio?.())).toThrow(
      'useAudio debe usarse dentro de AudioProvider',
    );
  });
});
