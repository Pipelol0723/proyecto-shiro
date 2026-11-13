/**
 * useConnectionState — estado actual de la conexión con el core-host.
 *
 * Separado de `connection-context.tsx` por la convención de Fast Refresh
 * (un archivo solo exporta componentes). Fuera de un `ConnectionProvider`
 * devuelve `'open'`.
 */

import { useCallback, useContext, useSyncExternalStore } from 'react';
import type { TransportState } from '@proyecto-shiro/core';
import { ConnectionContext } from './connection-context';

export function useConnectionState(): TransportState {
  const source = useContext(ConnectionContext);
  const subscribe = useCallback((onChange: () => void) => source.onStateChange(onChange), [source]);
  return useSyncExternalStore(subscribe, source.getState);
}
