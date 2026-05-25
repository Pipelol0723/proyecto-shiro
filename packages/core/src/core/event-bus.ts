/**
 * EventBus — versión 1 (Feynman paso 1).
 *
 * Esta es la implementación más simple posible del patrón pub/sub.
 * Sirve para entender la idea limpia antes de añadir todos los
 * detalles "de verdad" (tipado, async, transport, manejo de errores).
 *
 * El siguiente commit la reescribe en v2 con:
 * - Generics sobre EventMap (cada evento tipado)
 * - Handlers async esperados en paralelo
 * - Try/catch para que un handler bugueado no rompa los demás
 * - Disposer devuelto por on() para anular sin tener la referencia
 * - Inyección de ITransport para eventos remotos (ADR 0003)
 *
 * Mantener este archivo en su forma simple en este commit deja un
 * "antes" claro en el historial git. La diff entre este commit y el
 * siguiente es el material de estudio.
 *
 * Ver ADR 0001 (event-driven) y ADR 0005 (typed events).
 */

export type SimpleHandler = (payload: unknown) => void;

export class EventBus {
  private listeners = new Map<string, SimpleHandler[]>();

  /**
   * Emite un evento síncronamente. Si un handler lanza, los siguientes
   * NO se ejecutan — limitación que v2 corrige.
   */
  emit(event: string, payload: unknown): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  }

  /**
   * Suscribe un handler. Para anular hay que llamar a `off` con la misma
   * referencia — v2 introduce un disposer que evita guardarla.
   */
  on(event: string, handler: SimpleHandler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.push(handler);
    } else {
      this.listeners.set(event, [handler]);
    }
  }

  off(event: string, handler: SimpleHandler): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
  }
}
