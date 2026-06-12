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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parseEnvelope, serializeEnvelope } from '@proyecto-shiro/core';
import type { ITransport, Logger, TransportReceiveHandler } from '@proyecto-shiro/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/**
 * Handler de un request HTTP no-upgrade. Devuelve `true` si el handler
 * gestionó la respuesta (escribió status + body). Si todos devuelven
 * `false`, el transport responde 404 por defecto.
 */
export type HttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

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

  /**
   * `http.Server` propio que aloja tanto el WebSocketServer como las
   * rutas HTTP registradas via `onRequest`. Creamos uno nuestro (no
   * dejar que `WebSocketServer` lo cree internamente) para poder
   * añadirle handlers de `request` para servir audio del TTS — ver
   * ADR 0020 sección "audio en V1".
   */
  private readonly httpServer: Server;
  private readonly server: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly logger: Logger;
  private readonly readyPromise: Promise<void>;
  private readonly httpHandlers: HttpRequestHandler[] = [];
  private receiver: TransportReceiveHandler | undefined;
  private readonly connectionHandlers: (() => void | Promise<void>)[] = [];
  private closed = false;

  constructor(options: WebSocketServerTransportOptions) {
    this.logger = options.logger.child({ module: 'WebSocketServerTransport' });
    this.httpServer = createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });
    this.server = new WebSocketServer({
      server: this.httpServer,
      path: options.path ?? '/bus',
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.httpServer.once('listening', () => {
        const addr = this.httpServer.address();
        const where = typeof addr === 'string' ? addr : `puerto ${addr?.port ?? '?'}`;
        this.logger.info(`escuchando en ${where} (path ${options.path ?? '/bus'})`);
        resolve();
      });
      this.httpServer.once('error', (err) => {
        reject(err);
      });
      this.httpServer.listen(options.port);
    });

    // `ws` re-emite los errores del httpServer (incluido el EADDRINUSE al
    // bindear el puerto) sobre la instancia del WebSocketServer. Sin un
    // listener aquí, Node trata ese 'error' como no manejado y tumba el
    // proceso con un stack feo ANTES de que `ready()` llegue a rechazar.
    // Lo absorbemos a debug: el rechazo de `readyPromise` (via el 'error'
    // del httpServer, arriba) es quien lleva el fallo a quien hizo `ready()`,
    // que decide qué hacer (ver el manejo de EADDRINUSE en server.ts).
    this.server.on('error', (err) => {
      this.logger.debug('WebSocketServer error (se maneja vía ready())', { err });
    });

    this.server.on('connection', (ws) => {
      this.handleConnection(ws);
    });
  }

  /**
   * Registra un handler HTTP. Múltiples handlers se prueban en orden
   * de registro; el primero que devuelve `true` gana. Si ninguno
   * gestiona el request, el transport responde 404.
   */
  onRequest(handler: HttpRequestHandler): void {
    this.httpHandlers.push(handler);
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    for (const handler of this.httpHandlers) {
      try {
        if (handler(req, res)) return;
      } catch (err) {
        this.logger.error('http handler falló', { err });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
        return;
      }
    }
    if (!res.headersSent) {
      res.statusCode = 404;
      res.end('Not Found');
    }
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
    const addr = this.httpServer.address();
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
   * conecta. Lo usan el bootstrap para empujar `memory:snapshot` (rehidratar
   * el historial del cliente) y el healthcheck para emitir `system:health`.
   *
   * Se admiten **varios** handlers y se invocan todos, en orden de registro.
   * (Antes solo se guardaba el último, así que un segundo `onConnection`
   * pisaba al primero — por eso el snapshot dejó de emitirse en cuanto el
   * healthcheck añadió el suyo.) Si un handler devuelve `Promise`, se ejecuta
   * fire-and-forget: los errores van al log y nunca tumban la conexión recién
   * aceptada.
   */
  onConnection(handler: () => void | Promise<void>): void {
    this.connectionHandlers.push(handler);
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
    // Cierra primero el WebSocketServer (libera el upgrade handler);
    // después el httpServer que aloja también las rutas HTTP.
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.logger.info(`cliente conectado (total=${this.clients.size})`);

    for (const h of this.connectionHandlers) {
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
