/**
 * InProcessTransport — implementación de `ITransport` para Fase 1.
 *
 * "In-process" significa: el evento ya está en el mismo proceso Node
 * que el receptor, así que no hace falta serializarlo, ni enviarlo por
 * red, ni esperar reconexiones. El EventBus reparte los eventos a sus
 * handlers locales directamente — este transport es esencialmente un
 * stub que satisface el contrato.
 *
 * ¿Por qué existir entonces? Tres razones:
 *
 * 1. **Forma uniforme de configuración**: el `ModuleLoader` (Fase 1B)
 *    construirá el EventBus pasándole `transports: [new InProcessTransport()]`.
 *    Cuando llegue móvil, será `[new InProcessTransport(), new WebSocketTransport()]`.
 *    Misma maquinaria, distinta lista.
 *
 * 2. **Test del binding**: con `simulateReceive` los tests pueden
 *    inyectar un evento "como si viniera del otro lado" sin levantar
 *    red real. Valida la ruta `transport → bus → handlers`.
 *
 * 3. **Documentación viva**: el archivo en sí es la referencia mínima
 *    de cómo se implementa un Transport. Quien escriba `WebSocketTransport`
 *    en el futuro usa este como esqueleto.
 *
 * Ver ADR 0003.
 */

import type { ITransport, TransportReceiveHandler } from '../../interfaces/ITransport.js';

export class InProcessTransport implements ITransport {
  readonly id: string = 'in-process';

  private receiver: TransportReceiveHandler | undefined;
  private closed = false;

  send(_event: string, _payload: unknown): Promise<void> {
    // No-op por diseño: el EventBus reparte localmente a sus handlers
    // sin necesidad de transport. Este método existe para satisfacer
    // el contrato `ITransport` uniformemente.
    return Promise.resolve();
  }

  onReceive(handler: TransportReceiveHandler): void {
    this.receiver = handler;
  }

  close(): Promise<void> {
    this.closed = true;
    this.receiver = undefined;
    return Promise.resolve();
  }

  /**
   * Test helper: simula un evento entrante "del otro lado".
   * El bus suscrito vía `onReceive` lo recibe como cualquier evento remoto.
   *
   * Solo para tests. No usar en código de producción.
   */
  simulateReceive(event: string, payload: unknown): Promise<void> {
    if (this.closed || !this.receiver) return Promise.resolve();
    return this.receiver(event, payload);
  }
}
