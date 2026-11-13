/**
 * useSystemHealth — suscribe el reporte de salud del sistema que el
 * core-host emite por `system:health`, y permite re-pedirlo con
 * `system:health-check`.
 *
 * El chequeo lo hace el core-host (server-side, sin CORS — ADR 0024 §6);
 * este hook solo recibe el reporte y lo expone para que el setup wizard
 * lo renderice. Al montar pide un chequeo fresco; el server además lo
 * empuja al conectar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventMap, IEventBus, SystemHealthReport } from '@proyecto-shiro/core';

/** Si el core-host no responde en este tiempo, se deja de «comprobar». */
const HEALTH_TIMEOUT_MS = 8000;

export interface UseSystemHealthOptions {
  bus: IEventBus<EventMap>;
}

export interface UseSystemHealthResult {
  /** Último reporte recibido, o `null` si aún no llegó ninguno. */
  report: SystemHealthReport | null;
  /** `true` entre que se pide un chequeo y llega el reporte. */
  checking: boolean;
  /** `true` si pasó `HEALTH_TIMEOUT_MS` sin que llegara el reporte pedido. */
  timedOut: boolean;
  /** Pide al core-host un (re)chequeo. */
  refresh: () => void;
}

export function useSystemHealth(options: UseSystemHealthOptions): UseSystemHealthResult {
  const { bus } = options;
  const [report, setReport] = useState<SystemHealthReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(() => {
    setChecking(true);
    setTimedOut(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setChecking(false);
      setTimedOut(true);
    }, HEALTH_TIMEOUT_MS);
    void bus.emit('system:health-check', {});
  }, [bus]);

  useEffect(() => {
    const unsubscribe = bus.on('system:health', (payload) => {
      clearTimeout(timer.current);
      setReport(payload);
      setChecking(false);
      setTimedOut(false);
    });
    // Pide un chequeo al montar. El server también lo empuja al conectar,
    // así que con cualquiera de los dos el wizard se llena.
    refresh();
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
    };
  }, [bus, refresh]);

  return { report, checking, timedOut, refresh };
}
