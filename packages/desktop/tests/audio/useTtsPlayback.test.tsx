/**
 * Tests del `useTtsPlayback` con HTMLAudioElement mockeado y EventBus real.
 * Verifica el contrato: que el hook reproduce tras `tts:audio`, emite
 * `tts:audio-ended` al terminar, respeta el toggle muted y cancela
 * cuando recibe `tts:cancel`.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  _src: string;
  crossOrigin: string | null;
  paused: boolean;
  _listeners: Map<string, (() => void)[]>;
  play: () => Promise<void>;
  pause: () => void;
  addEventListener: (event: string, listener: () => void) => void;
  trigger(event: 'ended' | 'error' | 'playing'): void;
}

function makeFakeAudio(): FakeAudio {
  const fake: FakeAudio = {
    // Como el navegador: asignar '' a un audio con fuente dispara `error`.
    get src(): string {
      return fake._src;
    },
    set src(value: string) {
      const hadSource = fake._src !== '';
      fake._src = value;
      if (value === '' && hadSource) fake.trigger('error');
    },
    _src: '',
    crossOrigin: null,
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

const AUDIO_A = { url: '/audio/a.mp3', audioId: 'a', mimeType: 'audio/mpeg', userId: 'me' };

describe('useTtsPlayback — de qué servidor sale el audio (P-14)', () => {
  async function play(
    url: string,
    hostUrl?: string,
  ): Promise<{ audio: FakeAudio; ended: EventMap['tts:audio-ended'][] }> {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (payload) => {
      ended.push(payload);
    });
    renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
          ...(hostUrl !== undefined && { hostUrl }),
        }),
      { wrapper: wrap(bus) },
    );
    await act(async () => {
      await bus.emit('tts:audio', { url, audioId: 'a', mimeType: 'audio/mpeg', userId: 'me' });
    });
    return { audio, ended };
  }

  it('con el bus en otra máquina, pide el audio a esa máquina', async () => {
    const { audio } = await play('/audio/a.mp3', 'ws://shiro-host.test:9000/bus');
    expect(audio.src).toBe('http://shiro-host.test:9000/audio/a.mp3');
    expect(audio.paused).toBe(false);
  });

  it('sin decirle dónde está el bus, lo pide al de siempre', async () => {
    const { audio } = await play('/audio/a.mp3');
    expect(audio.src).toBe('http://localhost:9876/audio/a.mp3');
  });

  it('un audio de otro servidor no se reproduce, y el turno no se queda «hablando»', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { audio, ended } = await play('http://otro.invalid/audio/a.mp3');

    expect(audio.src).toBe('');
    expect(audio.paused).toBe(true);
    expect(ended).toEqual([{ userId: 'me', audioId: 'a' }]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  /** Emite un audio y, acto seguido, su cancelación; devuelve los fines que salieron. */
  async function playThenCancel(
    url: string,
    muted: boolean,
  ): Promise<{ ended: EventMap['tts:audio-ended'][]; created: number }> {
    const bus = makeBus();
    const factory = vi.fn(() => makeFakeAudio() as unknown as HTMLAudioElement);
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (payload) => {
      ended.push(payload);
    });
    renderHook(() => useTtsPlayback({ bus, audioFactory: factory, muted }), {
      wrapper: wrap(bus),
    });
    await act(async () => {
      await bus.emit('tts:audio', { url, audioId: 'a', mimeType: 'audio/mpeg', userId: 'me' });
      await bus.emit('tts:cancel', { audioId: 'a', userId: 'me' });
    });
    return { ended, created: factory.mock.calls.length };
  }

  it('un audio descartado no crea reproductor, y cancelarlo después no repite el fin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ended, created } = await playThenCancel('http://otro.invalid/audio/a.mp3', false);

    expect(created).toBe(0);
    expect(ended).toEqual([{ userId: 'me', audioId: 'a' }]);
    warn.mockRestore();
  });

  it('silenciado, cancelar un audio que no llegó a sonar tampoco repite el fin', async () => {
    const { ended, created } = await playThenCancel('/audio/a.mp3', true);

    expect(created).toBe(0);
    expect(ended).toEqual([{ userId: 'me', audioId: 'a' }]);
  });
});

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
        url: '/audio/abc.mp3',
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
        url: '/audio/a.mp3',
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
        url: '/audio/a.mp3',
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
        url: '/audio/a.mp3',
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
        url: '/audio/a.mp3',
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
        url: '/audio/a.mp3',
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

  it('expone audioElement con crossOrigin anonymous y lo limpia al terminar', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const { result } = renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
        }),
      { wrapper: wrap(bus) },
    );

    expect(result.current.audioElement).toBeNull();

    await act(async () => {
      await bus.emit('tts:audio', {
        url: '/audio/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });

    // Expuesto para el lip-sync, y con crossOrigin para que el análisis
    // cross-origin no quede tainted (ADR 0021 §5 / ADR 0020 CORS).
    expect(result.current.audioElement).toBe(audio as unknown as HTMLAudioElement);
    expect(audio.crossOrigin).toBe('anonymous');

    act(() => {
      audio.trigger('ended');
    });

    await waitFor(() => {
      expect(result.current.audioElement).toBeNull();
    });
  });

  it('muted=true no expone audioElement (lip-sync inactivo)', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const { result } = renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: true,
        }),
      { wrapper: wrap(bus) },
    );

    await act(async () => {
      await bus.emit('tts:audio', {
        url: '/audio/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });

    expect(result.current.audioElement).toBeNull();
  });

  it('cortar un audio al llegar otro no emite tts:audio-ended del anterior', async () => {
    const bus = makeBus();
    const first = makeFakeAudio();
    const second = makeFakeAudio();
    const queue = [first, second];
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });
    renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => queue.shift() as unknown as HTMLAudioElement,
          muted: false,
        }),
      { wrapper: wrap(bus) },
    );

    await act(async () => {
      await bus.emit('tts:audio', { ...AUDIO_A, audioId: 'a' });
    });
    await act(async () => {
      await bus.emit('tts:audio', { ...AUDIO_A, audioId: 'b' });
    });

    expect(first.paused).toBe(true);
    expect(ended.filter((e) => e.audioId === 'a')).toHaveLength(0);

    act(() => {
      second.trigger('ended');
    });
    await waitFor(() => {
      expect(ended).toEqual([{ userId: 'me', audioId: 'b' }]);
    });
  });

  it('tts:cancel emite exactamente un tts:audio-ended', async () => {
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
      { wrapper: wrap(bus) },
    );

    await act(async () => {
      await bus.emit('tts:audio', AUDIO_A);
    });
    await act(async () => {
      await bus.emit('tts:cancel', { audioId: 'a', userId: 'me' });
    });

    await waitFor(() => {
      expect(ended).toHaveLength(1);
    });
    expect(ended[0]).toEqual({ userId: 'me', audioId: 'a' });
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

  it('desmontar el hook con un audio sonando emite tts:audio-ended para no dejar speaking colgado', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const ended: EventMap['tts:audio-ended'][] = [];
    bus.on('tts:audio-ended', (p) => {
      ended.push(p);
    });
    const { unmount } = renderHook(
      () =>
        useTtsPlayback({
          bus,
          audioFactory: () => audio as unknown as HTMLAudioElement,
          muted: false,
        }),
      { wrapper: wrap(bus) },
    );
    await act(async () => {
      await bus.emit('tts:audio', AUDIO_A);
    });

    unmount();

    await waitFor(() => {
      expect(ended).toEqual([{ userId: 'me', audioId: 'a' }]);
    });
  });

  it('si play() rechaza y además salta error, emite un solo tts:audio-ended', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    audio.play = () => Promise.reject(new Error('NotSupportedError'));
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
      { wrapper: wrap(bus) },
    );

    await act(async () => {
      await bus.emit('tts:audio', AUDIO_A);
    });
    act(() => {
      audio.trigger('error');
    });

    await waitFor(() => {
      expect(ended).toHaveLength(1);
    });
  });
});

// P-16: la latencia que importa es hasta que se oye la voz. Solo el cliente
// sabe cuándo empieza a sonar, así que lo dice.
describe('useTtsPlayback — primer audio (P-16)', () => {
  it('cuando la voz empieza a sonar avisa con tts:audio-started, una sola vez', async () => {
    const bus = makeBus();
    const audio = makeFakeAudio();
    const started: EventMap['tts:audio-started'][] = [];
    bus.on('tts:audio-started', (payload) => {
      started.push(payload);
    });
    renderHook(
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
        url: '/audio/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });
    expect(started).toEqual([]);

    await act(async () => {
      audio.trigger('playing');
      // Tras una pausa por falta de datos, `playing` se repite: no cuenta otra vez.
      audio.trigger('playing');
      await Promise.resolve();
    });

    expect(started).toEqual([{ audioId: 'a', userId: 'me' }]);
  });

  it('silenciado no hay voz que empiece: no avisa', async () => {
    const bus = makeBus();
    const started: EventMap['tts:audio-started'][] = [];
    bus.on('tts:audio-started', (payload) => {
      started.push(payload);
    });
    renderHook(() => useTtsPlayback({ bus, muted: true }), { wrapper: wrap(bus) });

    await act(async () => {
      await bus.emit('tts:audio', {
        url: '/audio/a.mp3',
        audioId: 'a',
        mimeType: 'audio/mpeg',
        userId: 'me',
      });
    });

    expect(started).toEqual([]);
  });
});
