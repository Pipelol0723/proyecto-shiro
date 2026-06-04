/**
 * Tests del `useTtsPlayback` con HTMLAudioElement mockeado y EventBus real.
 * Verifica el contrato: que el hook reproduce tras `tts:audio`, emite
 * `tts:audio-ended` al terminar, respeta el toggle muted y cancela
 * cuando recibe `tts:cancel`.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import {
  EventBus,
  InProcessTransport,
  Logger,
  type EventMap,
  type IEventBus,
} from '@proyecto-shiro/core';
import { BusProvider } from '../../src/bus-context';
import { useTtsPlayback } from '../../src/audio/useTtsPlayback';

function makeBus(): IEventBus<EventMap> {
  return new EventBus<EventMap>({
    logger: new Logger('error', { module: 'test' }),
    transports: [new InProcessTransport()],
  });
}

function wrap(bus: IEventBus<EventMap>) {
  return ({ children }: { children: ReactNode }) => <BusProvider bus={bus}>{children}</BusProvider>;
}

interface FakeAudio {
  src: string;
  paused: boolean;
  _listeners: Map<string, (() => void)[]>;
  play: () => Promise<void>;
  pause: () => void;
  addEventListener: (event: string, listener: () => void) => void;
  trigger(event: 'ended' | 'error'): void;
}

function makeFakeAudio(): FakeAudio {
  const fake: FakeAudio = {
    src: '',
    paused: true,
    _listeners: new Map<string, (() => void)[]>(),
    play: () => {
      fake.paused = false;
      return Promise.resolve();
    },
    pause: () => {
      fake.paused = true;
    },
    addEventListener: (event: string, listener: () => void) => {
      const list = fake._listeners.get(event) ?? [];
      list.push(listener);
      fake._listeners.set(event, list);
    },
    trigger: (event) => {
      const list = fake._listeners.get(event);
      if (list) for (const l of list) l();
    },
  };
  return fake;
}

describe('useTtsPlayback', () => {
  it('reproduce el audio recibido vía tts:audio', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
        }),
      {
        wrapper: wrap(bus),
      },
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: 'http://localhost:9876/audio/abc.mp3',
        audioId: 'abc',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });

    expect(audio.src).toBe('http://localhost:9876/audio/abc.mp3');
    expect(audio.paused).toBe(false);
  });

  it('emite tts:audio-ended cuando el audio termina', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });
    renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
        }),
      {
        wrapper: wrap(bus),
      },
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: 'http://x/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });

    act(() => {
      audio.trigger('ended');
    });

    await waitFor(() => {
      expect(ended).toHaveLength(1);
    });
    expect(ended[0]).toEqual({ userId: 'me', audioId: 'a' });
  });

  it('muted=true emite tts:audio-ended SIN reproducir el audio', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });
    renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: true,
        }),
      {
        wrapper: wrap(bus),
      },
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: 'http://x/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });

    await waitFor(() => {
      expect(ended).toHaveLength(1);
    });
    expect(audio.src).toBe(''); // nunca se reprodujo
  });

  it('tts:cancel detiene el audio en curso y emite tts:audio-ended', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });
    renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
        }),
      {
        wrapper: wrap(bus),
      },
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: 'http://x/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });
    expect(audio.paused).toBe(false);

    await act(async () => {
      await bus.emit('tts:cancel', { audioId: 'a', userId: 'me' });
    });

    expect(audio.paused).toBe(true);
    await waitFor(() => {
      expect(ended.some((e) => e.audioId === 'a')).toBe(true);
    });
  });

  it('tts:cancel con audioId distinto no afecta al audio actual', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
        }),
      {
        wrapper: wrap(bus),
      },
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: 'http://x/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });
    expect(audio.paused).toBe(false);

    await act(async () => {
      await bus.emit('tts:cancel', { audioId: 'otro', userId: 'me' });
    });
    expect(audio.paused).toBe(false); // sigue reproduciéndose
  });

  it('cancel() programático emite tts:cancel con el audioId actual', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const cancels: EventMap['tts:cancel'][] = [];
    bus.on('tts:cancel', (p) => {
      cancels.push(p);
    });
    const { result } = renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
        }),
      { wrapper: wrap(bus) },
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: 'http://x/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => {
      expect(cancels).toHaveLength(1);
    });
    expect(cancels[0]).toEqual({ audioId: 'a', userId: 'me' });
  });

  it('cancel() sin audio en curso es no-op', () => {
    const bus = makeBus();
    const cancels: EventMap['tts:cancel'][] = [];
    bus.on('tts:cancel', (p) => {
      cancels.push(p);
    });
    const { result } = renderHook(() => useTtsPlayback({ bus, muted: false }), {
      wrapper: wrap(bus),
    });

    act(() => {
      result.current.cancel();
    });

    expect(cancels).toHaveLength(0);
  });

  it('setMuted persiste en localStorage', () => {
    window.localStorage.removeItem('shiro:tts:muted');
    const bus = makeBus();
    const { result } = renderHook(() => useTtsPlayback({ bus }), { wrapper: wrap(bus) });

    act(() => {
      result.current.setMuted(true);
    });

    expect(window.localStorage.getItem('shiro:tts:muted')).toBe('true');
    window.localStorage.removeItem('shiro:tts:muted');
  });
});
