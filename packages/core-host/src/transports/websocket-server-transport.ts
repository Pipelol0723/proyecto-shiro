/**
 * WebSocketServerTransport — implementación server-side de `ITransport`.
 *
 * Usa el paquete `ws` para abrir un servidor WebSocket y mantener N
 * conexiones de clientes (cliente desktop hoy, móvil mañana, Arduino
 * pasado mañana). Cada evento emitido se hace broadcast a todos los
 * clientes conectados; cada mensaje entrante de cualquier cliente se
 * inyecta en el bus local del server.
 *
 * Patrón de uso (PR 3 lo cableará):
 *
 * ```ts
 * const transport = new WebSocketServerTransport({ port: 9876, logger });
 * await transport.ready();
 * const bus = new EventBus({ logger, transports: [transport] });
 * ```
 *
 * El `ready()` espera al evento `listening` del servidor. Si quieres usar
 * un puerto efímero en tests, pasa `port: 0` y luego lee `transport.port`.
 *
 * Ver ADR 0012 (split cliente/server) y ADR 0013 (protocolo).
 */

import { parseEnvelope, serializeEnvelope } from '@proyecto-shiro/core';
import type { ITransport, Logger, TransportReceiveHandler } from '@proyecto-shiro/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/**
 * `ws` entrega payloads como `Buffer | ArrayBuffer | Buffer[]`. Para
 * envolverlos en string usamos UTF-8 explícito — evita el warning de
 * `@typescript-eslint/no-base-to-string` y nos asegura que el resultado
 * es texto, no `[object Object]`.
 */
function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export interface WebSocketServerTransportOptions {
  /** Puerto a vincular. `0` para que el SO asigne uno libre (útil en tests). */
  port: number;
  /** Path del endpoint WS. Default `/bus`. */
  path?: string;
  /** Logger padre. El transport crea un child con `module: 'WebSocketServerTransport'`. */
  logger: Logger;
}

export class WebSocketServerTransport implements ITransport {
  readonly id = 'websocket-server';

  private readonly server: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly logger: Logger;
  private readonly readyPromise: Promise<void>;
  private receiver: TransportReceiveHandler | undefined;
  private connectionHandler: (() => void | Promise<void>) | undefined;
  private closed = false;

  constructor(options: WebSocketServerTransportOptions) {
    this.logger = options.logger.child({ module: 'WebSocketServerTransport' });
    this.server = new WebSocketServer({
      port: options.port,
      path: options.path ?? '/bus',
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.server.once('listening', () => {
        const addr = this.server.address();
        const where = typeof addr === 'string' ? addr : `puerto ${addr?.port ?? '?'}`;
        this.logger.info(`escuchando en ${where} (path ${options.path ?? '/bus'})`);
        resolve();
      });
      this.server.once('error', (err) => {
        reject(err);
      });
    });

    this.server.on('connection', (ws) => {
      this.handleConnection(ws);
    });
  }

  /** Espera al evento `listening`. Resuelve cuando el server está vinculado. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Puerto realmente vinculado. Solo válido después de que `ready()`
   * resuelva. Útil cuando construiste con `port: 0`.
   */
  get port(): number {
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('WebSocketServerTransport: server no vinculado todavía');
    }
    return addr.port;
  }

  /** Snapshot del número de clientes conectados actualmente. */
  get clientCount(): number {
    return this.clients.size;
  }

  send(event: string, payload: unknown): Promise<void> {
    if (this.closed) return Promise.resolve();
    const raw = serializeEnvelope(event, payload);
    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(raw);
        sent += 1;
      } catch (err) {
        this.logger.error(`fallo al enviar ${event} a un cliente`, { err });
      }
    }
    this.logger.debug(`broadcast ${event} a ${sent}/${this.clients.size} clientes`);
    return Promise.resolve();
  }

  onReceive(handler: TransportReceiveHandler): void {
    this.receiver = handler;
  }

  /**
   * Registra un handler que se invoca cada vez que un cliente nuevo se
   * conecta. Lo usa el bootstrap para empujar `memory:snapshot` y dejar
   * que el cliente hidrate su historial al reconectar.
   *
   * Solo se admite un handler; llamadas posteriores lo sustituyen. Si el
   * handler devuelve `Promise`, se ejecuta fire-and-forget (los errores
   * van al log; nunca tumban la conexión recién aceptada).
   */
  onConnection(handler: () => void | Promise<void>): void {
    this.connectionHandler = handler;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const c of this.clients) {
      try {
        c.close();
      } catch (err) {
        this.logger.warn('error cerrando cliente durante shutdown', { err });
      }
    }
    this.clients.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.logger.info(`cliente conectado (total=${this.clients.size})`);

    if (this.connectionHandler !== undefined) {
      const h = this.connectionHandler;
      Promise.resolve(h()).catch((err: unknown) => {
        this.logger.error('connection handler falló', { err });
      });
    }

    ws.on('message', (data) => {
      const raw = rawDataToString(data);
      const result = parseEnvelope(raw);
      if (!result.ok) {
        this.logger.error(`envelope inválido del cliente: ${result.reason}`);
        return;
      }
      if (!this.receiver) return;
      const r = this.receiver;
      Promise.resolve(r(result.envelope.name, result.envelope.payload)).catch((err: unknown) => {
        this.logger.error(`receiver falló para ${result.envelope.name}`, { err });
      });
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      this.logger.info(`cliente desconectado (total=${this.clients.size})`);
    });

    ws.on('error', (err) => {
      this.logger.warn('error en cliente', { err });
    });
  }
}
