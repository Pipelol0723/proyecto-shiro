import type { Unsubscribe } from './IEventBus.js';

/**
 * Handler de evento recibido por el transport desde "el otro lado".
 * El bus se suscribe a esto para reinyectar eventos remotos al flujo local.
 */
export type TransportReceiveHandler = (event: string, payload: unknown) => Promise<void>;

/**
 * Estado de conexión de un transport con conexión (WebSocket, MQTT…).
 * Mismo vocabulario que `readyState` del WebSocket.
 */
export type TransportState = 'connecting' | 'open' | 'closing' | 'closed';

/** Listener de cambios de estado de un transport observable. */
export type TransportStateHandler = (state: TransportState) => void;

/**
 * Contrato de un Transport — la capa que decide CÓMO viaja un evento
 * físicamente entre procesos/dispositivos.
 *
 * El EventBus delega en uno o varios Transports. Implementaciones
 * previstas:
 *
 * - `InProcessTransport` (Fase 1): no-op real, los eventos no salen del proceso.
 * - `WebSocketTransport`: para clientes desktop remotos y móvil.
 * - `MQTTTransport`: para Home Assistant e IoT.
 * - `SerialTransport`: para Arduino conectado por USB.
 *
 * El payload es `unknown` porque a este nivel ya está fuera del sistema
 * de tipos de TS (cruza la red). Quien recibe valida con zod si hace falta.
 *
 * Ver ADR 0003.
 */
export interface ITransport {
  /**
   * Identificador del transport. Útil para logging y para que el bus
   * sepa qué transport produjo un evento (evitar loops infinitos).
   */
  readonly id: string;

  /**
   * Envía un evento al otro lado del transport. La serialización
   * (JSON, MessagePack, formato Arduino, etc.) es responsabilidad
   * de la implementación.
   */
  send(event: string, payload: unknown): Promise<void>;

  /**
   * Registra un handler para eventos que vienen DEL otro lado.
   * Solo puede haber un handler activo — el segundo `onReceive` reemplaza
   * al primero. (El bus es quien lo registra una sola vez al arrancar.)
   */
  onReceive(handler: TransportReceiveHandler): void;

  /**
   * Cierra el transport limpiamente. Libera sockets, USB, conexiones MQTT.
   */
  close(): Promise<void>;
}

/**
 * Transport que además expone su estado de conexión, para que la UI pueda
 * pintar "conectando" / "sin conexión". `ITransport` no cambia: los
 * transports sin conexión real (`InProcessTransport`) no lo implementan.
 */
export interface IObservableTransport extends ITransport {
  /** Estado actual de la conexión. */
  getState(): TransportState;

  /**
   * Registra un listener que se llama en cada cambio de estado (no se
   * llama si el estado no cambia ni con el valor actual al registrarse).
   * Devuelve la función de baja.
   */
  onStateChange(handler: TransportStateHandler): Unsubscribe;
}
