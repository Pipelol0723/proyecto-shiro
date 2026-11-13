/**
 * Tests del hook `useMicrophonePTT`. En jsdom no hay `getUserMedia` ni
 * `AudioContext`, así que el hook debe entrar en estado `unsupported`
 * y `start()` debe ser un no-op silencioso. El flujo de captura real
 * (con `MediaStream` y `AudioWorklet`) se verifica manualmente en el
 * browser de preview.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import type { EventMap } from '@proyecto-shiro/core';
import { useMicrophonePTT } from '../../src/audio/useMicrophonePTT';

const whisperMock = vi.hoisted(() => ({
  abort: vi.fn(),
  stop: vi.fn(() => Promise.resolve()),
  sendChunk: vi.fn(),
  open: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/audio/whisper-stt-client', () => ({
  WhisperSttClient: class {
    open = whisperMock.open;
    stop = whisperMock.stop;
    abort = whisperMock.abort;
    sendChunk = whisperMock.sendChunk;
  },
}));

function makeBus(): EventBus<EventMap> {
  return new EventBus({ logger: new Logger('error', { module: 'test' }) });
}

describe('useMicrophonePTT (jsdom)', () => {
  it('detecta entorno sin micro y queda en `unsupported`', () => {
    const bus = makeBus();
    const { result } = renderHook(() => useMicrophonePTT({ bus, userId: 'me' }));
    expect(result.current.state).toBe('unsupported');
    expect(result.current.error).toBeNull();
  });

  it('start() es no-op en `unsupported`', async () => {
    const bus = makeBus();
    const emitSpy = vi.spyOn(bus, 'emit');
    const { result } = renderHook(() => useMicrophonePTT({ bus, userId: 'me' }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('unsupported');
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('no registra listeners de teclado cuando `enabled: false`', () => {
    const bus = makeBus();
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useMicrophonePTT({ bus, userId: 'me', enabled: false }));
    const keydownCalls = addSpy.mock.calls.filter((c) => c[0] === 'keydown');
    expect(keydownCalls).toHaveLength(0);
    addSpy.mockRestore();
  });
});

describe('useMicrophonePTT.cancel()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function stubCaptureApis(): {
    track: { stop: ReturnType<typeof vi.fn> };
    closeContext: ReturnType<typeof vi.fn>;
  } {
    const track = { stop: vi.fn() };
    const closeContext = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [track] })) },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 16_000;
        audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
        createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
        close = closeContext;
      },
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port = { close: vi.fn(), onmessage: null };
        disconnect = vi.fn();
      },
    );
    return { track, closeContext };
  }

  it('a mitad de grabación corta sin pedir transcripción: no emite stt:transcribed, aborta y queda idle', async () => {
    const { track, closeContext } = stubCaptureApis();
    const bus = makeBus();
    const emitSpy = vi.spyOn(bus, 'emit');
    const { result } = renderHook(() => useMicrophonePTT({ bus, userId: 'me', enabled: false }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe('recording');

    act(() => {
      result.current.cancel();
    });

    expect(whisperMock.abort).toHaveBeenCalledTimes(1);
    expect(whisperMock.stop).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
    expect(emitSpy.mock.calls.map((c) => c[0])).not.toContain('stt:transcribed');
    // Suelta el micro de verdad: sin esto el indicador del sistema seguiría encendido.
    expect(track.stop).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
  });

  it('es no-op si no se está grabando', () => {
    const bus = makeBus();
    const { result } = renderHook(() => useMicrophonePTT({ bus, userId: 'me', enabled: false }));
    act(() => {
      result.current.cancel();
    });
    expect(whisperMock.abort).not.toHaveBeenCalled();
  });
});
