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

import {
  createServer,
  STATUS_CODES,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Duplex } from 'node:stream';
import { parseEnvelope, serializeEnvelope } from '@proyecto-shiro/core';
import type { ITransport, Logger, TransportReceiveHandler } from '@proyecto-shiro/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { DEFAULT_BIND_HOST } from './bind-host.js';
import { describeRejectedOrigin, isOriginAllowed } from './origin-policy.js';

/**
 * Tope de un mensaje entrante. El default de `ws` son 100 MiB; los eventos
 * del bus son JSON pequeños (el audio no viaja por aquí).
 */
const MAX_PAYLOAD_BYTES = 1_048_576;

/** Responde a un upgrade que no se acepta y cierra el socket al terminar de escribir. */
function rejectUpgrade(socket: Duplex, status: number): void {
  const reason = STATUS_CODES[status] ?? 'Error';
  socket.once('finish', () => {
    socket.destroy();
  });
  socket.end(
    `HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

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
  /**
   * Host en el que escuchar. Default `127.0.0.1` (solo esta máquina): el bus
   * no tiene auth, así que abrirlo a la red es un opt-in. Ver ADR 0027, 2a.
   */
  host?: string;
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
  private readonly path: string;
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
    this.path = options.path ?? '/bus';
    // `noServer`: el upgrade lo decide `handleUpgrade` (path y `Origin`) antes
    // de que exista un WebSocket. La documentación de `ws` recomienda el
    // evento `upgrade` frente a `verifyClient`.
    this.server = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    this.httpServer.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.httpServer.once('listening', () => {
        const addr = this.httpServer.address();
        const where =
          typeof addr === 'string' || addr === null
            ? String(addr)
            : `${addr.family === 'IPv6' ? `[${addr.address}]` : addr.address}:${String(addr.port)}`;
        this.logger.info(`escuchando en ${where} (path ${this.path})`);
        resolve();
      });
      this.httpServer.once('error', (err) => {
        reject(err);
      });
      // Listener permanente: sin él, un 'error' posterior del httpServer
      // (p. ej. sin descriptores al aceptar) tumbaría el proceso. Antes lo
      // absorbía el propio `ws`, que con `noServer` ya no escucha al server.
      this.httpServer.on('error', (err) => {
        this.logger.debug('httpServer error (el de arranque se maneja vía ready())', { err });
      });
      this.httpServer.listen(options.port, options.host ?? DEFAULT_BIND_HOST);
    });

    // El EADDRINUSE al bindear llega por el 'error' del httpServer (arriba):
    // el rechazo de `readyPromise` lleva el fallo a quien hizo `ready()`, que
    // decide qué hacer (ver server.ts). Este listener es solo una red para
    // que un 'error' del WebSocketServer nunca quede sin manejar.
    this.server.on('error', (err) => {
      this.logger.debug('WebSocketServer error', { err });
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

  /**
   * Decide un upgrade a WebSocket. Solo pasa el path del bus y un `Origin`
   * permitido (ADR 0027, 2a); el resto se rechaza antes de crear el
   * WebSocket, así que los `connection handlers` (que mandan el
   * `memory:snapshot`) nunca se disparan para un origen ajeno.
   */
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // Sin esto, un error del socket durante el rechazo quedaría sin manejar.
    socket.on('error', () => {
      socket.destroy();
    });
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== this.path) {
      rejectUpgrade(socket, 400);
      return;
    }
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin)) {
      this.logger.warn(describeRejectedOrigin(origin));
      rejectUpgrade(socket, 403);
      return;
    }
    this.server.handleUpgrade(req, socket, head, (ws) => {
      this.server.emit('connection', ws, req);
    });
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

  /**
   * IP realmente vinculada (p. ej. `127.0.0.1`). Solo válida después de
   * que `ready()` resuelva, igual que `port`.
   */
  get address(): string {
    const addr = this.httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('WebSocketServerTransport: server no vinculado todavía');
    }
    return addr.address;
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
