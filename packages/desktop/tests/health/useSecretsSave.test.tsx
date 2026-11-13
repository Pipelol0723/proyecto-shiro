/**
 * Tests de useSecretsSave: sin conexión no se emite nada (R-120).
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import { useSecretsSave } from '../../src/health/useSecretsSave';

function makeFakeBus(): { bus: IEventBus<EventMap>; emitted: string[] } {
  const emitted: string[] = [];
  const bus = {
    on: () => () => undefined,
    emit: (event: string) => {
      emitted.push(event);
      return Promise.resolve();
    },
  } as unknown as IEventBus<EventMap>;
  return { bus, emitted };
}

describe('useSecretsSave', () => {
  it('con conexión save() pasa a saving y emite secrets:save', () => {
    const { bus, emitted } = makeFakeBus();
    const { result } = renderHook(() => useSecretsSave(bus, true));
    act(() => {
      result.current.save({ anthropic: 'k' });
    });
    expect(result.current.status).toBe('saving');
    expect(emitted).toEqual(['secrets:save']);
  });

  it('sin conexión save() pasa a error y no emite secrets:save', () => {
    const { bus, emitted } = makeFakeBus();
    const { result } = renderHook(() => useSecretsSave(bus, false));
    act(() => {
      result.current.save({ anthropic: 'k' });
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/Sin conexión con el core-host/);
    expect(emitted).toEqual([]);
  });
});
