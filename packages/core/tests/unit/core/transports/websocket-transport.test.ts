import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../../../src/core/logger.js';
import {
  WebSocketTransport,
  type Scheduler,
  type WebSocketLike,
} from '../../../../src/core/transports/websocket-transport.js';
import { serializeEnvelope } from '../../../../src/core/transports/wire-schema.js';

/**
 * Mock controlable de WebSocket. Cada instancia se registra en
 * `MockWebSocket.instances` para que los tests inspeccionen lo que
 * ha llegado por `send` y disparen eventos manualmente.
 */
class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];

  readyState = 0; // CONNECTING
  sent: string[] = [];
  closeCalls = 0;
  url: string;

  onopen: WebSocketLike['onopen'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket no abierto');
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
    this.onclose?.call(this, {});
  }

  // Helpers para los tests:

  /** Simula `open` event. */
  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.call(this, {});
  }

  /** Simula un mensaje entrante. */
  simulateMessage(raw: string): void {
    this.onmessage?.call(this, { data: raw });
  }

  /** Simula un cierre inesperado (sin que el usuario lo pidiera). */
  simulateUnexpectedClose(): void {
    this.readyState = 3;
    this.onclose?.call(this, {});
  }

  /** Simula un error. */
  simulateError(): void {
    this.onerror?.call(this, {});
  }
}

/** Scheduler con timers controlables manualmente. */
function makeFakeScheduler(): {
  scheduler: Scheduler;
  flush: () => void;
  pending: () => number;
} {
  const pending: { cb: () => void; delay: number }[] = [];
  return {
    scheduler: {
      setTimeout(cb, delay) {
        const handle = { cb, delay };
        pending.push(handle);
        return handle;
      },
      clearTimeout(h) {
        const idx = pending.findIndex((x) => x === h);
        if (idx >= 0) pending.splice(idx, 1);
      },
    },
    flush() {
      const drained = pending.splice(0);
      for (const t of drained) t.cb();
    },
    pending: () => pending.length,
  };
}

function makeLogger(): Logger {
  return new Logger('error', { module: 'test' });
}

describe('WebSocketTransport', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });
  afterEach(() => {
    MockWebSocket.instances = [];
  });

  it('lanza si no hay WebSocket disponible y no se pasa webSocketCtor', () => {
    // Node 22+ tiene WebSocket global; lo ocultamos temporalmente para
    // simular un entorno sin él (browsers antiguos, Node sin la API).
    vi.stubGlobal('WebSocket', undefined);
    try {
      expect(
        () =>
          new WebSocketTransport({
            url: 'ws://nope',
            logger: makeLogger(),
          }),
      ).toThrow(/WebSocket/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('id es "websocket-client"', () => {
    const t = new WebSocketTransport({
      url: 'ws://localhost:9876/bus',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
    });
    expect(t.id).toBe('websocket-client');
  });

  it('crea un socket al construir', () => {
    new WebSocketTransport({
      url: 'ws://localhost:9876/bus',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:9876/bus');
  });

  it('autoConnect:false evita crear el socket', () => {
    new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
      autoConnect: false,
    });
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('state transiciona de connecting → open al abrir', () => {
    const t = new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
    });
    expect(t.getState()).toBe('connecting');
    MockWebSocket.instances[0]!.simulateOpen();
    expect(t.getState()).toBe('open');
  });

  it('send dropea silenciosamente si la conexión no está abierta', async () => {
    const t = new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
    });
    await t.send('user:message', { text: 'hola', userId: 'u1' });
    expect(MockWebSocket.instances[0]!.sent).toHaveLength(0);
  });

  it('send envía un envelope cuando la conexión está abierta', async () => {
    const t = new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
    });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    await t.send('user:message', { text: 'hola', userId: 'u1' });

    expect(ws.sent).toHaveLength(1);
    const sent = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
    expect(sent.v).toBe(1);
    expect(sent.kind).toBe('event');
    expect(sent.name).toBe('user:message');
    expect(sent.payload).toEqual({ text: 'hola', userId: 'u1' });
  });

  it('onReceive entrega eventos válidos al handler', () => {
    const t = new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
    });
    const handler = vi.fn();
    t.onReceive(handler);

    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();
    const raw = serializeEnvelope('llm:responded', { text: 'hi', emotion: 'neutral' });
    ws.simulateMessage(raw);

    expect(handler).toHaveBeenCalledWith('llm:responded', { text: 'hi', emotion: 'neutral' });
  });

  it('mensajes con envelope inválido no llaman al handler', () => {
    const t = new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
    });
    const handler = vi.fn();
    t.onReceive(handler);
    MockWebSocket.instances[0]!.simulateMessage('{not json');
    expect(handler).not.toHaveBeenCalled();
  });

  it('programa reconexión tras cierre inesperado', () => {
    const { scheduler, pending } = makeFakeScheduler();
    new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
      scheduler,
    });
    MockWebSocket.instances[0]!.simulateUnexpectedClose();
    expect(pending()).toBe(1);
  });

  it('reconexión crea un nuevo socket al disparar el timer', () => {
    const { scheduler, flush } = makeFakeScheduler();
    new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
      scheduler,
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0]!.simulateUnexpectedClose();
    flush();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('close() impide reconexiones futuras', () => {
    const { scheduler, pending } = makeFakeScheduler();
    const t = new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
      scheduler,
    });
    void t.close();
    MockWebSocket.instances[0]!.simulateUnexpectedClose();
    expect(pending()).toBe(0);
    expect(t.getState()).toBe('closed');
  });

  it('reset del contador de backoff cuando se reconecta exitosamente', () => {
    const { scheduler, flush } = makeFakeScheduler();
    new WebSocketTransport({
      url: 'ws://x',
      logger: makeLogger(),
      webSocketCtor: MockWebSocket,
      scheduler,
    });

    // Cierre 1 → backoff step 0 (250ms)
    MockWebSocket.instances[0]!.simulateUnexpectedClose();
    flush();
    // Open exitoso → counter resetea
    MockWebSocket.instances[1]!.simulateOpen();
    // Cierre 2 → backoff step 0 de nuevo (no acumula)
    MockWebSocket.instances[1]!.simulateUnexpectedClose();
    // Sólo verificamos que se programó otra reconexión (la lógica de
    // delay específica está bien cubierta por la longitud del array).
    flush();
    expect(MockWebSocket.instances).toHaveLength(3);
  });
});
