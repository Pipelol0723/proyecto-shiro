/**
 * Tests del hook useSystemHealth.
 *
 * Fake bus mínimo: registra los `emit` y deja disparar el callback de
 * `system:health` a mano para simular el reporte que manda el core-host.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventMap, IEventBus, SystemHealthReport } from '@proyecto-shiro/core';
import { useSystemHealth } from '../../src/health/useSystemHealth';

interface FakeBus {
  bus: IEventBus<EventMap>;
  emitted: { event: string; payload: unknown }[];
  /** Dispara el handler suscrito a `system:health`. */
  pushHealth: (report: SystemHealthReport) => void;
  healthHandlerCount: () => number;
}

function makeFakeBus(): FakeBus {
  const emitted: { event: string; payload: unknown }[] = [];
  const healthHandlers = new Set<(p: SystemHealthReport) => void>();

  const bus = {
    on: (event: string, handler: (p: never) => void) => {
      if (event === 'system:health') {
        healthHandlers.add(handler as (p: SystemHealthReport) => void);
        return () => healthHandlers.delete(handler as (p: SystemHealthReport) => void);
      }
      return () => undefined;
    },
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return Promise.resolve();
    },
  } as unknown as IEventBus<EventMap>;

  return {
    bus,
    emitted,
    pushHealth: (report) => {
      for (const h of healthHandlers) h(report);
    },
    healthHandlerCount: () => healthHandlers.size,
  };
}

const REPORT: SystemHealthReport = {
  services: { ollama: 'ok', letta: 'down', whisper: 'ok' },
  secrets: { anthropic: false, elevenlabs: true },
  checkedAt: '2026-06-10T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSystemHealth', () => {
  it('pide un chequeo al montar (emite system:health-check)', () => {
    const fake = makeFakeBus();
    renderHook(() => useSystemHealth({ bus: fake.bus }));
    expect(fake.emitted.filter((e) => e.event === 'system:health-check')).toHaveLength(1);
  });

  it('arranca en checking=true sin reporte', () => {
    const fake = makeFakeBus();
    const { result } = renderHook(() => useSystemHealth({ bus: fake.bus }));
    expect(result.current.checking).toBe(true);
    expect(result.current.report).toBeNull();
  });

  it('al recibir system:health expone el reporte y baja checking', () => {
    const fake = makeFakeBus();
    const { result } = renderHook(() => useSystemHealth({ bus: fake.bus }));
    act(() => {
      fake.pushHealth(REPORT);
    });
    expect(result.current.report).toEqual(REPORT);
    expect(result.current.checking).toBe(false);
  });

  it('refresh() vuelve a emitir system:health-check y pone checking', () => {
    const fake = makeFakeBus();
    const { result } = renderHook(() => useSystemHealth({ bus: fake.bus }));
    act(() => {
      fake.pushHealth(REPORT);
    });
    expect(result.current.checking).toBe(false);
    act(() => {
      result.current.refresh();
    });
    expect(result.current.checking).toBe(true);
    expect(fake.emitted.filter((e) => e.event === 'system:health-check')).toHaveLength(2);
  });

  it('limpia la suscripción al desmontar', () => {
    const fake = makeFakeBus();
    const { unmount } = renderHook(() => useSystemHealth({ bus: fake.bus }));
    expect(fake.healthHandlerCount()).toBe(1);
    unmount();
    expect(fake.healthHandlerCount()).toBe(0);
  });
});
