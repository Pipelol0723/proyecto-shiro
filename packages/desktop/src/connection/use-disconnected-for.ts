/**
 * useDisconnectedFor — `true` cuando la conexión lleva `graceMs` sin estar
 * abierta. Evita que avisos (banner, tarjeta de Setup) parpadeen en
 * reconexiones rápidas o al arrancar.
 */

import { useEffect, useState } from 'react';
import { useConnectionState } from './use-connection';

export const DISCONNECT_GRACE_MS = 1000;

export function useDisconnectedFor(graceMs: number = DISCONNECT_GRACE_MS): boolean {
  const state = useConnectionState();
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (state === 'open') {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => {
      setElapsed(true);
    }, graceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [state, graceMs]);

  return state !== 'open' && elapsed;
}
