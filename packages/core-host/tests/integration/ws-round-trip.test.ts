/**
 * Integration test — cliente WebSocketTransport y server
 * WebSocketServerTransport hablando entre sí, cada uno con su propio
 * EventBus. Valida el flujo end-to-end del wire format definido en
 * ADR 0013:
 *
 *   bus(client).emit('user:message', ...)
 *     → WebSocketTransport.send → wire → WebSocketServerTransport.recv
 *     → bus(server).dispatchLocal
 *
 *   bus(server).emit('llm:responded', ...)
 *     → WebSocketServerTransport.send (broadcast)
 *     → wire → WebSocketTransport.recv → bus(client).dispatchLocal
 *
 * Usa `ws.WebSocket` como `webSocketCtor` del cliente porque Node no
 * tiene `WebSocket` global hasta v22.4 con flag. El paquete `ws` cubre
 * ambos lados en el entorno de tests.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import { WebSocketTransport } from '@proyecto-shiro/core';
import type { WebSocketCtor } from '@proyecto-shiro/core';
import { WebSocket } from 'ws';
import { WebSocketServerTransport } from '../../src/transports/websocket-server-transport.js';

function makeLogger(): Logger {
  return new Logger('error', { module: 'integration-test' });
}

function tick(ms = 30): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('WebSocket round-trip (cliente ↔ server)', () => {
  const cleanup: (() => Promise<void>)[] = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.shift();
      if (fn) await fn();
    }
  });

  it('un evento emitido en el cliente llega al bus del server', async () => {
    const serverTransport = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => serverTransport.close());
    await serverTransport.ready();
    const serverBus = new EventBus({ logger: makeLogger(), transports: [serverTransport] });

    const clientTransport = new WebSocketTransport({
      url: `ws://localhost:${serverTransport.port}/bus`,
      logger: makeLogger(),
      webSocketCtor: WebSocket as unknown as WebSocketCtor,
    });
    cleanup.push(() => clientTransport.close());
    const clientBus = new EventBus({ logger: makeLogger(), transports: [clientTransport] });

    // Espera a que el cliente esté conectado.
    await waitFor(() => clientTransport.getState() === 'open');
    await tick();

    const received: { text: string; userId: string }[] = [];
    serverBus.on('user:message', (payload) => {
      received.push(payload);
    });

    await clientBus.emit('user:message', { text: 'hola', userId: 'u1' });
    await waitFor(() => received.length === 1);

    expect(received[0]).toEqual({ text: 'hola', userId: 'u1' });
  });

  it('un evento emitido en el server llega al bus del cliente', async () => {
    const serverTransport = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => serverTransport.close());
    await serverTransport.ready();
    const serverBus = new EventBus({ logger: makeLogger(), transports: [serverTransport] });

    const clientTransport = new WebSocketTransport({
      url: `ws://localhost:${serverTransport.port}/bus`,
      logger: makeLogger(),
      webSocketCtor: WebSocket as unknown as WebSocketCtor,
    });
    cleanup.push(() => clientTransport.close());
    const clientBus = new EventBus({ logger: makeLogger(), transports: [clientTransport] });

    await waitFor(() => clientTransport.getState() === 'open');
    await tick();

    const received: { startedAt: string }[] = [];
    clientBus.on('bus:ready', (payload) => {
      received.push(payload);
    });

    await serverBus.emit('bus:ready', { startedAt: '2026-05-27T00:00:00.000Z' });
    await waitFor(() => received.length === 1);

    expect(received[0]).toEqual({ startedAt: '2026-05-27T00:00:00.000Z' });
  });

  it('round-trip completo: cliente → server → cliente (simula turno conversacional)', async () => {
    const serverTransport = new WebSocketServerTransport({ port: 0, logger: makeLogger() });
    cleanup.push(() => serverTransport.close());
    await serverTransport.ready();
    const serverBus = new EventBus({ logger: makeLogger(), transports: [serverTransport] });

    // Server-side: cuando llega user:message, responde con llm:responded
    serverBus.on('user:message', async () => {
      await serverBus.emit('llm:responded', {
        text: 'hola tú',
        emotion: 'divertida',
        userId: 'u1',
        tier: 'local',
        latencyMs: 50,
      });
    });

    const clientTransport = new WebSocketTransport({
      url: `ws://localhost:${serverTransport.port}/bus`,
      logger: makeLogger(),
      webSocketCtor: WebSocket as unknown as WebSocketCtor,
    });
    cleanup.push(() => clientTransport.close());
    const clientBus = new EventBus({ logger: makeLogger(), transports: [clientTransport] });

    await waitFor(() => clientTransport.getState() === 'open');
    await tick();

    const replies: { text: string; emotion: string }[] = [];
    clientBus.on('llm:responded', (payload) => {
      replies.push({ text: payload.text, emotion: payload.emotion });
    });

    await clientBus.emit('user:message', { text: 'hola', userId: 'u1' });
    await waitFor(() => replies.length === 1);

    expect(replies[0]).toEqual({ text: 'hola tú', emotion: 'divertida' });
  });
});

/**
 * Polling utilitario — espera a que `predicate` devuelva true, con
 * timeout. Más fiable que `setTimeout(N)` fijo para eventos asíncronos
 * del event loop.
 */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 2000, intervalMs = 10 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: timeout tras ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
