/**
 * ConnectionProvider — expone el estado de conexión del transport al árbol
 * React (P-07a, L-BUG-10): el cliente sabe cuándo el core-host no está
 * disponible y puede avisar y bloquear el envío en vez de hablar a la nada.
 *
 * Recibe la parte observable del transport (`IObservableTransport`, definida
 * en core). Sin `source` (tests, demos con `InProcessTransport`) el estado es
 * `'open'` fijo. Por convención de Fast Refresh el hook vive en
 * `./use-connection.ts`.
 */

import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { IObservableTransport } from '@proyecto-shiro/core';

export type ConnectionSource = Pick<IObservableTransport, 'getState' | 'onStateChange'>;

const ALWAYS_OPEN: ConnectionSource = {
  getState: () => 'open',
  onStateChange: () => () => undefined,
};

// El context se exporta para que `./use-connection.ts` lo consuma. Nadie más
// debería importarlo directamente — use `useConnectionState()`.
// eslint-disable-next-line react-refresh/only-export-components -- el context vive con su Provider por simplicidad (mismo criterio que bus-context.tsx).
export const ConnectionContext = createContext<ConnectionSource>(ALWAYS_OPEN);

export interface ConnectionProviderProps {
  /** Transport (o doble de test) a observar. Omitir ⇒ siempre `open`. */
  source?: ConnectionSource;
  children: ReactNode;
}

export function ConnectionProvider({ source, children }: ConnectionProviderProps): JSX.Element {
  return (
    <ConnectionContext.Provider value={source ?? ALWAYS_OPEN}>
      {children}
    </ConnectionContext.Provider>
  );
}
