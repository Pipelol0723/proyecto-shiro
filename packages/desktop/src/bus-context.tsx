/**
 * BusProvider — pone un `IEventBus<EventMap>` en React context.
 *
 * Por convención de Fast Refresh (Vite), un archivo solo exporta
 * componentes. Los hooks asociados viven en `./use-bus.ts`.
 *
 * Ver ADR 0010 (wiring cliente↔core).
 */

import { createContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  EventBus,
  InProcessTransport,
  Logger,
  type EventMap,
  type IEventBus,
} from '@proyecto-shiro/core';

// El context se exporta para que los hooks de ./use-bus.ts lo consuman.
// Nadie más debería importarlo directamente — use `useBus()` o `useBusEvent()`.
// eslint-disable-next-line react-refresh/only-export-components -- el context vive con su Provider por simplicidad; el coste es perder HMR fino solo de este archivo, que es aceptable porque cambia raramente.
export const BusContext = createContext<IEventBus<EventMap> | null>(null);

export interface BusProviderProps {
  /** Si se pasa, se usa tal cual (tests). Si no, se construye uno. */
  bus?: IEventBus<EventMap>;
  children: ReactNode;
}

export function BusProvider({ bus, children }: BusProviderProps): JSX.Element {
  // Memoizamos para que un re-render del padre no instancie otro bus.
  const instance = useMemo<IEventBus<EventMap>>(() => {
    if (bus) return bus;
    const logger = new Logger();
    return new EventBus<EventMap>({
      logger,
      transports: [new InProcessTransport()],
    });
  }, [bus]);

  return <BusContext.Provider value={instance}>{children}</BusContext.Provider>;
}
