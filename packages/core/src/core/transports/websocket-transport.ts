/**
 * WebSocketTransport — implementación cliente de `ITransport` sobre
 * WebSocket. Browser-safe: usa `globalThis.WebSocket` por defecto y no
 * importa nada de Node.
 *
 * Reconexión automática con backoff exponencial:
 *   intento 1 → 250 ms
 *   intento 2 → 500 ms
 *   intento 3 → 1 s
 *   intento 4 → 2 s
 *   intento 5+ → 5 s (techo)
 *
 * Sin queue local: si `send()` se llama con la conexión caída, el mensaje
 * se descarta y se loguea. ADR 0013 lo establece — TCP/WS ya garantizan
 * orden y entrega mientras la conexión está viva; complicar el protocolo
 * con buffering no compensa para el caso de chat humano.
 *
 * Para tests, los dos puntos de extensión son:
 * - `webSocketCtor`: clase WebSocket-compatible (en tests Node usamos
 *   `ws.WebSocket` del paquete `ws`).
 * - `scheduler`: para controlar timers con `vi.useFakeTimers()`.
 *
 * Ver ADR 0013 (protocolo) y ADR 0003 (contrato ITransport).
 */

import type { ITransport, TransportReceiveHandler } from '../../interfaces/ITransport.js';
import type { Logger } from '../logger.js';
import { parseEnvelope, serializeEnvelope } from './wire-schema.js';

/**
 * Subset estructural de la API WebSocket que usamos. Tanto el
 * `WebSocket` global del browser como `ws.WebSocket` del paquete `ws`
 * son asignables a este tipo.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((this: WebSocketLike, ev: unknown) => void) | null;
  onclose: ((this: WebSocketLike, ev: unknown) => void) | null;
  onmessage: ((this: WebSocketLike, ev: { data: unknown }) => void) | null;
  onerror: ((this: WebSocketLike, ev: unknown) => void) | null;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

/**
 * Programador de timers — abstraído para que los tests inyecten timers
 * controlados (`vi.useFakeTimers()`). El handle es opaco para que cada
 * scheduler use su tipo nativo.
 */
export interface Scheduler {
  setTimeout(cb: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  setTimeout: (cb, delayMs) => setTimeout(cb, delayMs),
  clearTimeout: (h) => {
    clearTimeout(h as ReturnType<typeof setTimeout>);
  },
};

export interface WebSocketTransportOptions {
  /** URL completa, p.ej. `ws://localhost:9876/bus`. */
  url: string;
  /** Logger padre. El transport crea un child con `module: 'WebSocketTransport'`. */
  logger: Logger;
  /**
   * Constructor WebSocket-compatible. En browser: omitir y se usa
   * `globalThis.WebSocket`. En tests Node: pasar `ws.WebSocket`.
   */
  webSocketCtor?: WebSocketCtor;
  /** Override del scheduler — solo para tests con fake timers. */
  scheduler?: Scheduler;
  /**
   * Si `true`, no se conecta automáticamente al construir. Tendrás que
   * llamar a `connect()` explícitamente. Útil en tests que quieren
   * verificar la secuencia de conexión paso a paso.
   */
  autoConnect?: boolean;
}

type State = 'connecting' | 'open' | 'closing' | 'closed';

const BACKOFF_STEPS_MS = [250, 500, 1000, 2000, 5000] as const;
const WS_READY_STATE_OPEN = 1;

export class WebSocketTransport implements ITransport {
  readonly id = 'websocket-client';

  private readonly url: string;
  private readonly logger: Logger;
  private readonly webSocketCtor: WebSocketCtor;
  private readonly scheduler: Scheduler;

  private socket: WebSocketLike | null = null;
  private receiver: TransportReceiveHandler | undefined;
  private state: State = 'connecting';
  private reconnectAttempts = 0;
  private reconnectHandle: unknown = null;
  private userClosed = false;

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url;
    this.logger = options.logger.child({ module: 'WebSocketTransport' });
    this.scheduler = options.scheduler ?? defaultScheduler;

    const ctor = options.webSocketCtor ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (typeof ctor !== 'function') {
      throw new Error(
        'WebSocketTransport: no hay WebSocket disponible. Pasa `webSocketCtor` en las opciones o ejecuta en un entorno con `WebSocket` global.',
      );
    }
    this.webSocketCtor = ctor;

    if (options.autoConnect !== false) {
      this.connect();
    }
  }

  send(event: string, payload: unknown): Promise<void> {
    if (this.state !== 'open' || this.socket?.readyState !== WS_READY_STATE_OPEN) {
      this.logger.warn(`drop ${event} — conexión no abierta (state=${this.state})`);
      return Promise.resolve();
    }
    try {
      this.socket.send(serializeEnvelope(event, payload));
    } catch (err) {
      this.logger.error(`fallo al enviar ${event}`, { err });
    }
    return Promise.resolve();
  }

  onReceive(handler: TransportReceiveHandler): void {
    this.receiver = handler;
  }

  close(): Promise<void> {
    this.userClosed = true;
    this.state = 'closing';
    if (this.reconnectHandle !== null) {
      this.scheduler.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch (err) {
        this.logger.warn('close() falló silenciosamente', { err });
      }
      this.socket = null;
    }
    this.state = 'closed';
    return Promise.resolve();
  }

  /**
   * Estado actual del transport. Útil para tests y para que la UI
   * pinte "reconectando" mientras dura el backoff.
   */
  getState(): State {
    return this.state;
  }

  /**
   * Conecta manualmente. Solo necesario si construiste con
   * `autoConnect: false`. Idempotente — si ya hay socket activo, no hace nada.
   */
  connect(): void {
    if (this.userClosed) {
      this.logger.warn('connect() llamado después de close(), ignorado');
      return;
    }
    if (this.socket) return;

    this.state = 'connecting';
    const ws = new this.webSocketCtor(this.url);
    this.socket = ws;

    ws.onopen = () => {
      this.logger.info(`conectado a ${this.url}`);
      this.state = 'open';
      this.reconnectAttempts = 0;
    };

    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      const result = parseEnvelope(raw);
      if (!result.ok) {
        this.logger.error(`envelope inválido: ${result.reason}`);
        return;
      }
      if (this.receiver) {
        const r = this.receiver;
        Promise.resolve(r(result.envelope.name, result.envelope.payload)).catch((err: unknown) => {
          this.logger.error(`receiver falló para ${result.envelope.name}`, { err });
        });
      }
    };

    ws.onerror = () => {
      this.logger.warn(`error en websocket (state=${this.state})`);
    };

    ws.onclose = () => {
      if (this.userClosed) return;
      this.logger.warn(
        `conexión cerrada, programando reconexión (intento ${this.reconnectAttempts + 1})`,
      );
      this.state = 'closed';
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.userClosed) return;
    const idx = Math.min(this.reconnectAttempts, BACKOFF_STEPS_MS.length - 1);
    const delay = BACKOFF_STEPS_MS[idx]!;
    this.reconnectAttempts += 1;
    this.reconnectHandle = this.scheduler.setTimeout(() => {
      this.reconnectHandle = null;
      this.connect();
    }, delay);
  }
}
