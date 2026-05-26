/**
 * EventBus — versión 2 (refactor desde v1, Feynman paso 2).
 *
 * Pub/sub tipado con generics sobre EventMap. Comparar con la versión
 * anterior (commit previo de este archivo en git) para ver el "antes"
 * y "después" del refactor — es material de estudio.
 *
 * Cambios respecto a v1:
 * - **Tipado**: cada evento conoce su payload via `EventMap` (ADR 0005).
 * - **Async**: handlers `void | Promise<void>`, esperados en paralelo.
 * - **Resiliencia**: cada handler aislado en try/catch — un error en uno
 *   no rompe a los demás ni al emit.
 * - **Disposer pattern**: `on()` devuelve función de desuscripción.
 * - **Set en vez de Array**: deduplica registros del mismo handler.
 * - **Transports**: inyección opcional de `ITransport[]` (ADR 0003).
 *   Permite que eventos viajen a procesos remotos (móvil, Arduino) sin
 *   cambiar el contrato del bus.
 * - **Logging integrado**: cada emit logguea a debug, cada error a error.
 *
 * Ver ADR 0001 (event-driven), 0003 (transport), 0005 (typed events).
 */

import type { EventMap } from '../types/events.js';
import type { EventHandler, IEventBus, Unsubscribe } from '../interfaces/IEventBus.js';
import type { ITransport } from '../interfaces/ITransport.js';
import type { Logger } from './logger.js';

export interface EventBusOptions {
  /** Logger inyectado. El bus crea un child con `module: 'EventBus'`. */
  logger: Logger;
  /**
   * Transports activos. Cada evento emitido se envía por todos ellos.
   * Cada evento recibido desde un transport se reinyecta como handler local.
   * En Fase 1 típicamente: `[new InProcessTransport()]`.
   */
  transports?: ITransport[];
}

export class EventBus<TMap extends object = EventMap> implements IEventBus<TMap> {
  private readonly listeners = new Map<keyof TMap, Set<EventHandler<unknown>>>();
  private readonly logger: Logger;
  private readonly transports: ITransport[];

  constructor(options: EventBusOptions) {
    this.logger = options.logger.child({ module: 'EventBus' });
    this.transports = options.transports ?? [];

    // Suscribirse a cada transport: los eventos que vengan "del otro lado"
    // se reinyectan a los handlers locales (sin re-enviar a transports
    // de nuevo — eso crearía loops).
    for (const transport of this.transports) {
      this.bindTransport(transport);
    }
  }

  async emit<K extends keyof TMap>(event: K, payload: TMap[K]): Promise<void> {
    this.logger.debug(`emit ${String(event)}`);

    const localTask = this.dispatchLocal(event, payload);
    const transportTasks = this.transports.map(async (t) => {
      try {
        await t.send(String(event), payload);
      } catch (err) {
        this.logger.error(`transport ${t.id} failed to send ${String(event)}`, { err });
      }
    });

    await Promise.all([localTask, ...transportTasks]);
  }

  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): Unsubscribe {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(handler as EventHandler<unknown>);
    return () => {
      this.off(event, handler);
    };
  }

  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  clear(): void {
    this.listeners.clear();
  }

  /**
   * Despacha un evento a los handlers locales. Cada handler se ejecuta
   * en su propio try/catch: un error en uno no rompe a los demás.
   */
  private async dispatchLocal<K extends keyof TMap>(event: K, payload: TMap[K]): Promise<void> {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    await Promise.all(
      Array.from(handlers).map(async (handler) => {
        try {
          await handler(payload);
        } catch (err) {
          this.logger.error(`handler failed for ${String(event)}`, { err });
        }
      }),
    );
  }

  /**
   * Conecta un transport para que sus eventos entrantes vuelvan al bus.
   * Importante: NO re-emite por los demás transports — eso causaría loops.
   * Solo dispara handlers locales.
   */
  private bindTransport(transport: ITransport): void {
    transport.onReceive(async (event, payload) => {
      this.logger.debug(`received from ${transport.id}: ${event}`);
      // Cast inevitable: el transport ya está fuera del sistema de tipos
      // (red, USB, etc.). Cuando se añada validación con zod en el
      // transport (futuro), este cast pasa a ser un parseSync().
      const eventKey = event as keyof TMap;
      const handlers = this.listeners.get(eventKey);
      if (!handlers || handlers.size === 0) return;

      await Promise.all(
        Array.from(handlers).map(async (handler) => {
          try {
            await handler(payload);
          } catch (err) {
            this.logger.error(`handler failed for transport-incoming ${event}`, { err });
          }
        }),
      );
    });
  }
}

/**
 * Tipo de re-export para que el resto del codebase pueda hacer
 *   `import { EventBus } from '@proyecto-shiro/core'`
 * y obtener tanto la clase como el contrato tipado.
 */
export type { IEventBus, EventHandler, Unsubscribe };
