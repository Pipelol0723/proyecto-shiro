import type { EventMap } from '../types/events.js';

/**
 * Handler de un evento del bus. Puede ser sync o async — el bus espera a
 * todos los handlers en paralelo cuando emite.
 */
export type EventHandler<P> = (payload: P) => void | Promise<void>;

/**
 * Función que retorna `on()` para anular la suscripción sin tener que
 * recordar el handler original. Es el patrón "disposer".
 *
 * Uso:
 *   const dispose = bus.on('llm:chunk', handler);
 *   // ...más tarde
 *   dispose();
 */
export type Unsubscribe = () => void;

/**
 * Contrato del bus de eventos del core.
 *
 * Es genérico sobre `EventMap` para que cada paquete pueda extender los
 * eventos si lo necesita (p. ej. un cliente desktop puede añadir eventos
 * `ui:*` sin tocar el core).
 *
 * Ver ADR 0001 (event-driven) y ADR 0005 (string literals + EventMap).
 */
export interface IEventBus<TMap extends Record<string, unknown> = EventMap> {
  /**
   * Emite un evento. Devuelve una promesa que resuelve cuando todos los
   * handlers han terminado (los handlers async se esperan en paralelo).
   *
   * Si un handler lanza error, se loguea pero NO interrumpe a los demás
   * handlers ni al `emit`. Esto mantiene el bus resiliente: un módulo
   * bugueado no rompe el resto del sistema.
   */
  emit<K extends keyof TMap>(event: K, payload: TMap[K]): Promise<void>;

  /**
   * Suscribe un handler a un evento. Devuelve un disposer para anular
   * la suscripción.
   *
   * Si el mismo handler se registra dos veces para el mismo evento,
   * solo se ejecuta una vez (Set semantics).
   */
  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): Unsubscribe;

  /**
   * Anula la suscripción de un handler concreto. Alternativa al disposer
   * cuando se necesita anular por referencia.
   */
  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void;

  /**
   * Anula todos los handlers de todos los eventos. Útil en tests para
   * resetear el bus entre casos.
   */
  clear(): void;
}
