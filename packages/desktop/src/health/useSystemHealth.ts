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

import { useCallback, useEffect, useState } from 'react';
import type { EventMap, IEventBus, SystemHealthReport } from '@proyecto-shiro/core';

export interface UseSystemHealthOptions {
  bus: IEventBus<EventMap>;
}

export interface UseSystemHealthResult {
  /** Último reporte recibido, o `null` si aún no llegó ninguno. */
  report: SystemHealthReport | null;
  /** `true` entre que se pide un chequeo y llega el reporte. */
  checking: boolean;
  /** Pide al core-host un (re)chequeo. */
  refresh: () => void;
}

export function useSystemHealth(options: UseSystemHealthOptions): UseSystemHealthResult {
  const { bus } = options;
  const [report, setReport] = useState<SystemHealthReport | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(() => {
    setChecking(true);
    void bus.emit('system:health-check', {});
  }, [bus]);

  useEffect(() => {
    const unsubscribe = bus.on('system:health', (payload) => {
      setReport(payload);
      setChecking(false);
    });
    // Pide un chequeo al montar. El server también lo empuja al conectar,
    // así que con cualquiera de los dos el wizard se llena.
    refresh();
    return unsubscribe;
  }, [bus, refresh]);

  return { report, checking, refresh };
}
