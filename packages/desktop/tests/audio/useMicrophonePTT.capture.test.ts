/**
 * `useMicrophonePTT` con el cliente de Whisper de verdad y un WebSocket falso
 * (P-15a: R-322 y R-143).
 *
 * Lo que se fija aquí:
 *
 * - El micro empieza a capturar sin esperar a que el WS abra, y lo dicho
 *   entre tanto llega a Whisper en orden.
 * - Con Whisper sin contestar, el micro se suelta en menos de 5 s y el
 *   mensaje dice qué hacer.
 * - Soltar la tecla antes de tiempo no deja nada grabando.
 *
 * Que no se pierda la primera sílaba con un micro real se comprueba a mano
 * en la app (20 pruebas, criterio del gate de la Fase 2).
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import type { EventMap } from '@proyecto-shiro/core';
import { useMicrophonePTT } from '../../src/audio/useMicrophonePTT';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_FINAL_TIMEOUT_MS,
} from '../../src/audio/whisper-stt-client';

// ── dobles ───────────────────────────────────────────────────────────────────

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const last = FakeWebSocket.instances.at(-1);
    if (last === undefined) throw new Error('no hay WebSocket todavía');
    return last;
  }

  binaryType = 'arraybuffer';
  closed = false;
  readonly sent: (ArrayBuffer | string)[] = [];

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(data: ArrayBuffer | string): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
  }
  open(): void {
    this.dispatchEvent(new Event('open'));
  }
  message(payload: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
  /** Los trozos de audio que han salido, como listas de bytes. */
  audio(): number[][] {
    return this.sent
      .filter((item): item is ArrayBuffer => item instanceof ArrayBuffer)
      .map((item) => [...new Uint8Array(item)]);
  }
  texts(): unknown[] {
    return this.sent
      .filter((item): item is string => typeof item === 'string')
      .map((item) => JSON.parse(item) as unknown);
  }
}

interface Capture {
  track: { stop: ReturnType<typeof vi.fn> };
  closeContext: ReturnType<typeof vi.fn>;
  /** Entrega un trozo de audio como lo haría el worklet. */
  speak: (...bytes: number[]) => void;
  /** Resuelve o rechaza el permiso del micro, si se pidió «a mano». */
  grantMic: () => void;
  denyMic: (name: string) => void;
}

/** Sustituye las API de captura. Con `manualMic`, el permiso lo da el test. */
function stubCapture(options: { manualMic?: boolean } = {}): Capture {
  const track = { stop: vi.fn() };
  const closeContext = vi.fn(() => Promise.resolve());
  const stream = { getTracks: () => [track] };
  let resolveMic: (value: unknown) => void = () => undefined;
  let rejectMic: (err: unknown) => void = () => undefined;
  const ports: { onmessage: ((event: { data: unknown }) => void) | null }[] = [];

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() =>
        options.manualMic === true
          ? new Promise((resolve, reject) => {
              resolveMic = resolve;
              rejectMic = reject;
            })
          : Promise.resolve(stream),
      ),
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 16_000;
      audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
      createMediaStreamSource = (): unknown => ({ connect: vi.fn(), disconnect: vi.fn() });
      close = closeContext;
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port: { close: () => void; onmessage: ((event: { data: unknown }) => void) | null } = {
        close: vi.fn(),
        onmessage: null,
      };
      disconnect = vi.fn();
      constructor() {
        ports.push(this.port);
      }
    },
  );

  return {
    track,
    closeContext,
    speak: (...bytes) => {
      ports.at(-1)?.onmessage?.({ data: new Uint8Array(bytes).buffer });
    },
    grantMic: () => {
      resolveMic(stream);
    },
    denyMic: (name) => {
      const err = new Error('Permission denied');
      err.name = name;
      rejectMic(err);
    },
  };
}

function makeBus(): EventBus<EventMap> {
  return new EventBus({ logger: new Logger('error', { module: 'test' }) });
}

function setup(capture: Capture): {
  capture: Capture;
  result: { current: ReturnType<typeof useMicrophonePTT> };
  events: string[];
  transcribed: string[];
} {
  const bus = makeBus();
  const events: string[] = [];
  const transcribed: string[] = [];
  bus.on('stt:listening', () => {
    events.push('stt:listening');
  });
  bus.on('stt:transcribed', (payload) => {
    events.push('stt:transcribed');
    transcribed.push(payload.text);
  });
  const { result } = renderHook(() => useMicrophonePTT({ bus, userId: 'me', enabled: false }));
  return { capture, result, events, transcribed };
}

/** Deja correr las promesas pendientes (y el reloj falso, si se pide). */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── casos ────────────────────────────────────────────────────────────────────

describe('useMicrophonePTT — captura durante la apertura del WS', () => {
  it('empieza a escuchar sin esperar a Whisper, y lo dicho entre tanto llega en orden', async () => {
    const { capture, result, events } = setup(stubCapture());

    await act(async () => {
      await result.current.start();
    });
    const ws = FakeWebSocket.last();

    // El WS sigue abriendo y ya se está grabando.
    expect(result.current.state).toBe('recording');
    expect(events).toEqual(['stt:listening']);

    capture.speak(1);
    capture.speak(2);
    expect(ws.sent).toEqual([]);

    ws.open();
    await settle();
    capture.speak(3);

    expect(ws.audio()).toEqual([[1], [2], [3]]);
  });

  it('soltar antes de que Whisper abra no pierde lo dicho: lo envía al abrir y pide el final', async () => {
    const { capture, result, transcribed } = setup(stubCapture());
    await act(async () => {
      await result.current.start();
    });
    const ws = FakeWebSocket.last();
    capture.speak(5);

    let stopping: Promise<void> = Promise.resolve();
    act(() => {
      stopping = result.current.stop();
    });
    expect(result.current.state).toBe('finalizing');

    ws.open();
    await settle();
    expect(ws.audio()).toEqual([[5]]);
    expect(ws.texts()).toEqual([{ type: 'stop' }]);

    ws.message({ type: 'transcribed', text: 'hola', isFinal: true });
    await act(async () => {
      await stopping;
    });

    expect(result.current.state).toBe('idle');
    expect(transcribed).toEqual(['hola']);
    expect(capture.track.stop).toHaveBeenCalled();
  });
});

describe('useMicrophonePTT — Whisper no contesta', () => {
  it('si el WS no abre, suelta el micro en menos de 5 s y dice qué hacer', async () => {
    const { capture, result } = setup(stubCapture());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    await settle(DEFAULT_CONNECT_TIMEOUT_MS);

    expect(DEFAULT_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    expect(result.current.state).toBe('error');
    expect(capture.track.stop).toHaveBeenCalled();
    expect(capture.closeContext).toHaveBeenCalled();
    expect(FakeWebSocket.last().closed).toBe(true);
    expect(result.current.error).toMatch(/Whisper/);
    expect(result.current.error).toMatch(/Setup/);
    expect(result.current.error).not.toContain('ws://');
  });

  it('si la transcripción final no llega, suelta el micro y lo dice', async () => {
    const { capture, result, events } = setup(stubCapture());
    await act(async () => {
      await result.current.start();
    });
    const ws = FakeWebSocket.last();
    ws.open();
    await settle();

    act(() => {
      void result.current.stop();
    });
    await settle(DEFAULT_FINAL_TIMEOUT_MS);

    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/Whisper/);
    expect(capture.track.stop).toHaveBeenCalled();
    expect(ws.closed).toBe(true);
    expect(events).not.toContain('stt:transcribed');
  });

  it('tras un fallo se puede volver a intentar', async () => {
    const { capture, result } = setup(stubCapture());
    await act(async () => {
      await result.current.start();
    });
    await settle(DEFAULT_CONNECT_TIMEOUT_MS);
    expect(result.current.state).toBe('error');

    await act(async () => {
      await result.current.start();
    });
    FakeWebSocket.last().open();
    await settle();
    capture.speak(9);

    expect(result.current.state).toBe('recording');
    expect(result.current.error).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last().audio()).toEqual([[9]]);
  });
});

describe('useMicrophonePTT — el micro falla o se suelta antes de tiempo', () => {
  it('sin permiso, lo dice en claro y no deja el WS abierto', async () => {
    const capture = stubCapture({ manualMic: true });
    const { result, events } = setup(capture);
    act(() => {
      void result.current.start();
    });
    await settle();
    expect(result.current.state).toBe('requesting');

    capture.denyMic('NotAllowedError');
    await settle();

    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/permiso/i);
    expect(result.current.error).not.toContain('Permission denied');
    expect(FakeWebSocket.last().closed).toBe(true);
    expect(events).toEqual([]);
  });

  it('soltar mientras se pide el micro cancela el turno; el micro que llega después se suelta', async () => {
    const capture = stubCapture({ manualMic: true });
    const { result, events } = setup(capture);
    act(() => {
      void result.current.start();
    });
    await settle();

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.state).toBe('idle');
    expect(FakeWebSocket.last().closed).toBe(true);

    capture.grantMic();
    await settle();

    expect(result.current.state).toBe('idle');
    expect(capture.track.stop).toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('si Whisper falla mientras aún se pide el micro, el micro que llega después se suelta', async () => {
    const capture = stubCapture({ manualMic: true });
    const { result } = setup(capture);
    act(() => {
      void result.current.start();
    });
    await settle(DEFAULT_CONNECT_TIMEOUT_MS);
    expect(result.current.state).toBe('error');

    capture.grantMic();
    await settle();

    expect(result.current.state).toBe('error');
    expect(capture.track.stop).toHaveBeenCalled();
  });

  it('al desmontar a mitad de turno se cierra también el WS', async () => {
    const bus = makeBus();
    stubCapture();
    const { result, unmount } = renderHook(() =>
      useMicrophonePTT({ bus, userId: 'me', enabled: false }),
    );
    await act(async () => {
      await result.current.start();
    });
    FakeWebSocket.last().open();
    await settle();

    unmount();

    expect(FakeWebSocket.last().closed).toBe(true);
  });
});
