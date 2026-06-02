/**
 * Tests del hook `useMicrophonePTT`. En jsdom no hay `getUserMedia` ni
 * `AudioContext`, así que el hook debe entrar en estado `unsupported`
 * y `start()` debe ser un no-op silencioso. El flujo de captura real
 * (con `MediaStream` y `AudioWorklet`) se verifica manualmente en el
 * browser de preview.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import type { EventMap } from '@proyecto-shiro/core';
import { useMicrophonePTT } from '../../src/audio/useMicrophonePTT';

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
