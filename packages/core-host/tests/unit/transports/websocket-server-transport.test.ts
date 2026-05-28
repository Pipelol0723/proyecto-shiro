import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger, serializeEnvelope } from '@proyecto-shiro/core';
import { WebSocket, type RawData } from 'ws';
import { WebSocketServerTransport } from '../../../src/transports/websocket-server-transport.js';

function makeLogger(): Logger {
  return new Logger('error', { module: 'test' });
}

/** Espera unos ticks para que los eventos del event loop se procesen. */
function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Convierte el RawData del paquete `ws` a string UTF-8 sin ambigüedad. */
function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

describe('WebSocketServerTransport', () => {
  const cleanup: (() => void | Promise<void>)[] = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.shift();
      if (fn) await fn();
    }
  });

  it('id es "websocket-server"', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(t.id).toBe('websocket-server');
  });

  it('ready() resuelve cuando el server está escuchando', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(t.port).toBeGreaterThan(0);
  });

  it('clientCount empieza en 0', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(t.clientCount).toBe(0);
  });

  it('acepta una conexión de cliente y la cuenta', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      client.close();
    });
    await new Promise<void>((resolve) => client.once('open', () => resolve()));
    await tick(20);
    expect(t.clientCount).toBe(1);
  });

  it('send() broadcast un evento a un cliente conectado', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      client.close();
    });
    await new Promise<void>((resolve) => client.once('open', () => resolve()));

    const received = new Promise<string>((resolve) => {
      client.once('message', (data: RawData) => resolve(rawToString(data)));
    });
    await t.send('llm:responded', { text: 'hola', emotion: 'divertida' });
    const raw = await received;
    const env = JSON.parse(raw) as Record<string, unknown>;
    expect(env.name).toBe('llm:responded');
    expect(env.payload).toEqual({ text: 'hola', emotion: 'divertida' });
  });

  it('send() broadcast a múltiples clientes', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const c1 = new WebSocket(`ws://localhost:${t.port}/bus`);
    const c2 = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      c1.close();
      c2.close();
    });

    await Promise.all([
      new Promise<void>((r) => c1.once('open', () => r())),
      new Promise<void>((r) => c2.once('open', () => r())),
    ]);
    await tick(20);
    expect(t.clientCount).toBe(2);

    const got1 = new Promise<string>((r) => c1.once('message', (d: RawData) => r(rawToString(d))));
    const got2 = new Promise<string>((r) => c2.once('message', (d: RawData) => r(rawToString(d))));
    await t.send('bus:ready', { startedAt: 'now' });

    const [r1, r2] = await Promise.all([got1, got2]);
    expect(JSON.parse(r1)).toMatchObject({ name: 'bus:ready' });
    expect(JSON.parse(r2)).toMatchObject({ name: 'bus:ready' });
  });

  it('onReceive() entrega mensajes del cliente al handler', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const handler = vi.fn();
    t.onReceive(handler);

    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      client.close();
    });
    await new Promise<void>((resolve) => client.once('open', () => resolve()));

    client.send(serializeEnvelope('user:message', { text: 'hola', userId: 'u1' }));
    await tick(20);

    expect(handler).toHaveBeenCalledWith('user:message', { text: 'hola', userId: 'u1' });
  });

  it('envelopes inválidos del cliente se ignoran sin llamar al handler', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const handler = vi.fn();
    t.onReceive(handler);

    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      client.close();
    });
    await new Promise<void>((resolve) => client.once('open', () => resolve()));

    client.send('{not json');
    client.send(JSON.stringify({ v: 99, kind: 'event', name: 'x', payload: null, ts: 't' }));
    await tick(20);

    expect(handler).not.toHaveBeenCalled();
  });

  it('clientCount decrementa cuando un cliente se desconecta', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    await new Promise<void>((resolve) => client.once('open', () => resolve()));
    await tick(20);
    expect(t.clientCount).toBe(1);

    client.close();
    await tick(50);
    expect(t.clientCount).toBe(0);
  });

  it('close() cierra el server y desconecta clientes', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    await t.ready();
    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    await new Promise<void>((resolve) => client.once('open', () => resolve()));

    const closed = new Promise<void>((resolve) => {
      client.once('close', () => resolve());
    });
    await t.close();
    await closed;
    expect(t.clientCount).toBe(0);
  });

  it('send() después de close() es no-op', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    await t.ready();
    await t.close();
    await expect(t.send('user:message', { text: 'x', userId: 'u1' })).resolves.toBeUndefined();
  });
});
