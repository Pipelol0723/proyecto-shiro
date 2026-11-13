import { networkInterfaces } from 'node:os';
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

/** Primera IPv4 de la máquina que no es loopback, si la hay. */
function findExternalIPv4(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    const found = addresses?.find((a) => a.family === 'IPv4' && !a.internal);
    if (found) return found.address;
  }
  return undefined;
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

  it('escucha en 127.0.0.1 por defecto', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(t.address).toBe('127.0.0.1');
  });

  it('respeta un host explícito', async () => {
    const t = new WebSocketServerTransport({ port: 0, host: '0.0.0.0', logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(t.address).toBe('0.0.0.0');
  });

  // Sin interfaz no-loopback en este runner no hay por dónde probarlo.
  const externalIp = findExternalIPv4();
  it.skipIf(externalIp === undefined)(
    'no acepta conexiones por una IP no-loopback de la máquina',
    { timeout: 15_000 },
    async () => {
      const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
      cleanup.push(() => t.close());
      await t.ready();

      const client = new WebSocket(`ws://${externalIp ?? ''}:${t.port}/bus`);
      cleanup.push(() => {
        client.terminate();
      });
      const outcome = await new Promise<string>((resolve) => {
        client.once('open', () => resolve('open'));
        client.once('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? err.message));
      });
      expect(outcome).toBe('ECONNREFUSED');
      expect(t.clientCount).toBe(0);
    },
  );

  /**
   * Intenta abrir un WebSocket y cuenta cómo acaba: `'open'`, el status HTTP
   * con el que el servidor rechazó el upgrade, o el código de error.
   */
  function connectOutcome(url: string, origin?: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const client = new WebSocket(url, origin === undefined ? {} : { origin });
      cleanup.push(() => {
        client.terminate();
      });
      client.once('open', () => resolve('open'));
      client.once('unexpected-response', (_req, res) => resolve(String(res.statusCode)));
      client.once('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? err.message));
    });
  }

  it('rechaza con 403 un Origin ajeno', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const url = `ws://127.0.0.1:${t.port}/bus`;
    expect(await connectOutcome(url, 'https://evil.example')).toBe('403');
    // «null» es el Origin de una página file:// o de un iframe aislado.
    expect(await connectOutcome(url, 'null')).toBe('403');
    await tick(20);
    expect(t.clientCount).toBe(0);
  });

  it('un Origin rechazado no dispara los connection handlers', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    // Si se disparasen, el bootstrap mandaría el memory:snapshot al intruso.
    const onConnection = vi.fn();
    t.onConnection(onConnection);

    await connectOutcome(`ws://127.0.0.1:${t.port}/bus`, 'https://evil.example');
    await tick(20);
    expect(onConnection).not.toHaveBeenCalled();
  });

  it.each(['http://tauri.localhost', 'http://localhost:5173', 'http://127.0.0.1:5173'])(
    'acepta el Origin %s',
    async (origin) => {
      const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
      cleanup.push(() => t.close());
      await t.ready();
      expect(await connectOutcome(`ws://127.0.0.1:${t.port}/bus`, origin)).toBe('open');
    },
  );

  it('acepta un cliente sin Origin (2a, sin token)', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(await connectOutcome(`ws://127.0.0.1:${t.port}/bus`)).toBe('open');
  });

  it('un path distinto de /bus no hace upgrade', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(await connectOutcome(`ws://127.0.0.1:${t.port}/otro`)).toBe('400');
    expect(await connectOutcome(`ws://127.0.0.1:${t.port}/bus/extra`)).toBe('400');
    await tick(20);
    expect(t.clientCount).toBe(0);
  });

  it('ready() resuelve cuando el server está escuchando', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();
    expect(t.port).toBeGreaterThan(0);
  });

  it('ready() rechaza con EADDRINUSE si el puerto ya está ocupado, sin tumbar el proceso', async () => {
    const t1 = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t1.close());
    await t1.ready();

    // Un segundo transport sobre el MISMO puerto debe rechazar `ready()`
    // limpiamente. El EADDRINUSE llega por el 'error' del httpServer; sin
    // los listeners que añadimos, Node lo trataría como 'error' no manejado
    // y tumbaría el proceso (regresión del conflicto dev/sidecar — dos
    // core-hosts peleando por el 9876; ver server.ts `isAddrInUse`).
    const t2 = new WebSocketServerTransport({ port: t1.port, logger: makeLogger() });
    cleanup.push(async () => {
      try {
        await t2.close();
      } catch {
        // t2 nunca llegó a bindear; no hay handle que cerrar.
      }
    });

    await expect(t2.ready()).rejects.toMatchObject({ code: 'EADDRINUSE' });
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

  it('onConnection() se invoca cuando un cliente se conecta', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const handler = vi.fn();
    t.onConnection(handler);

    const c1 = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      c1.close();
    });
    await new Promise<void>((resolve) => c1.once('open', () => resolve()));
    await tick(20);
    expect(handler).toHaveBeenCalledTimes(1);

    const c2 = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      c2.close();
    });
    await new Promise<void>((resolve) => c2.once('open', () => resolve()));
    await tick(20);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('onConnection() admite varios handlers y los invoca todos', async () => {
    // Regresión: antes `onConnection` guardaba un solo handler y el segundo
    // pisaba al primero. En el bootstrap eso hacía que el healthcheck
    // (registrado después) borrara el push de `memory:snapshot` → el chat no
    // rehidrataba al reconectar. Ahora ambos handlers deben dispararse.
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    const first = vi.fn();
    const second = vi.fn();
    t.onConnection(first);
    t.onConnection(second);

    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      client.close();
    });
    await new Promise<void>((resolve) => client.once('open', () => resolve()));
    await tick(20);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('onConnection() captura errores del handler sin tumbar la conexión', async () => {
    const t = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => t.close());
    await t.ready();

    t.onConnection(() => Promise.reject(new Error('boom')));

    const client = new WebSocket(`ws://localhost:${t.port}/bus`);
    cleanup.push(() => {
      client.close();
    });
    await new Promise<void>((resolve) => client.once('open', () => resolve()));
    await tick(30);

    // El cliente sigue conectado pese al fallo del handler.
    expect(t.clientCount).toBe(1);
    expect(client.readyState).toBe(WebSocket.OPEN);
  });
});
