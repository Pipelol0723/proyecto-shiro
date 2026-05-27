/**
 * Hooks de acceso al EventBus desde componentes React.
 *
 * Separado de `bus-context.tsx` para que Fast Refresh de Vite no se
 * queje de mezcla de componentes y no-componentes en el mismo archivo.
 *
 * Ver ADR 0010 (wiring cliente↔core).
 */

import { useContext, useEffect, useRef } from 'react';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import { BusContext } from './bus-context';

/**
 * Devuelve el bus del context. Lanza si se llama fuera del BusProvider
 * — eso ayuda a detectar olvidos durante el desarrollo en lugar de
 * silenciar errores.
 */
export function useBus(): IEventBus<EventMap> {
  const bus = useContext(BusContext);
  if (!bus) {
    throw new Error('useBus() debe usarse dentro de <BusProvider>.');
  }
  return bus;
}

/**
 * Suscribe `handler` al evento `event` durante la vida del componente.
 * El handler se referencia vía `ref` para no re-suscribir en cada render
 * si el caller pasa una función inline (caso común).
 *
 * @example
 *   useBusEvent('llm:responded', (p) => {
 *     setEmotion(p.emotion);
 *   });
 */
export function useBusEvent<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void | Promise<void>,
): void {
  const bus = useBus();
  // Stable ref del handler — la subscripción se hace una sola vez
  // por mount, no por cada render que pase un handler nuevo.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const dispose = bus.on(event, (payload) => handlerRef.current(payload));
    return dispose;
  }, [bus, event]);
}
