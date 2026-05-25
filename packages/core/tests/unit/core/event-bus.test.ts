import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../../src/core/event-bus.js';
import { Logger } from '../../../src/core/logger.js';
import type { ITransport, TransportReceiveHandler } from '../../../src/interfaces/ITransport.js';

/**
 * EventMap propio para tests, desacoplado del EventMap del producto.
 * Esto demuestra que el EventBus es genérico y reusable.
 */
interface TestEvents {
  'foo:bar': { value: number };
  'baz:qux': { name: string };
}

function silentLogger(): Logger {
  // Logger con threshold error — no contamina la salida de los tests.
  return new Logger('error');
}

/** Helper para construir un transport mock con métodos espía. */
function mockTransport(id = 'mock'): ITransport & {
  __getReceiver(): TransportReceiveHandler | undefined;
} {
  let receiver: TransportReceiveHandler | undefined;
  return {
    id,
    send: vi.fn(() => Promise.resolve()),
    onReceive: vi.fn((handler: TransportReceiveHandler) => {
      receiver = handler;
    }),
    close: vi.fn(() => Promise.resolve()),
    __getReceiver: () => receiver,
  };
}

describe('EventBus', () => {
  let bus: EventBus<TestEvents>;

  beforeEach(() => {
    // El bus loguea a stderr cuando un handler o transport falla.
    // Silenciamos esa salida — los tests verifican comportamiento,
    // no formato de logs.
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    bus = new EventBus<TestEvents>({ logger: silentLogger() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('emit + on', () => {
    it('despacha el payload al handler suscrito', async () => {
      const handler = vi.fn();
      bus.on('foo:bar', handler);
      await bus.emit('foo:bar', { value: 42 });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({ value: 42 });
    });

    it('despacha a múltiples handlers del mismo evento', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('foo:bar', h1);
      bus.on('foo:bar', h2);
      await bus.emit('foo:bar', { value: 1 });
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('no despacha handlers de eventos diferentes', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('foo:bar', h1);
      bus.on('baz:qux', h2);
      await bus.emit('foo:bar', { value: 1 });
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).not.toHaveBeenCalled();
    });

    it('emit a un evento sin handlers es no-op (no lanza)', async () => {
      await expect(bus.emit('foo:bar', { value: 1 })).resolves.toBeUndefined();
    });

    it('deduplica el mismo handler registrado dos veces', async () => {
      const handler = vi.fn();
      bus.on('foo:bar', handler);
      bus.on('foo:bar', handler);
      await bus.emit('foo:bar', { value: 1 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('espera handlers async en paralelo', async () => {
      const order: string[] = [];
      bus.on('foo:bar', async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push('h1');
      });
      bus.on('foo:bar', async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('h2');
      });
      await bus.emit('foo:bar', { value: 1 });
      // h2 (10ms) termina antes que h1 (30ms) porque corren en paralelo
      expect(order).toEqual(['h2', 'h1']);
    });
  });

  describe('on disposer', () => {
    it('on() devuelve función que desuscribe', async () => {
      const handler = vi.fn();
      const dispose = bus.on('foo:bar', handler);
      dispose();
      await bus.emit('foo:bar', { value: 1 });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('quita un handler específico sin tocar los demás', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('foo:bar', h1);
      bus.on('foo:bar', h2);
      bus.off('foo:bar', h1);
      await bus.emit('foo:bar', { value: 1 });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('off sobre evento/handler inexistente no lanza', () => {
      const handler = vi.fn();
      expect(() => {
        bus.off('foo:bar', handler);
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('elimina todos los handlers', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('foo:bar', h1);
      bus.on('baz:qux', h2);
      bus.clear();
      await bus.emit('foo:bar', { value: 1 });
      await bus.emit('baz:qux', { name: 'x' });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });
  });

  describe('resiliencia ante errores en handlers', () => {
    it('un handler que lanza error no detiene a los demás', async () => {
      const ok1 = vi.fn();
      const ok2 = vi.fn();
      const broken = vi.fn(() => {
        throw new Error('boom');
      });
      bus.on('foo:bar', ok1);
      bus.on('foo:bar', broken);
      bus.on('foo:bar', ok2);
      await bus.emit('foo:bar', { value: 1 });
      expect(ok1).toHaveBeenCalled();
      expect(broken).toHaveBeenCalled();
      expect(ok2).toHaveBeenCalled();
    });

    it('un handler async que rechaza no detiene a los demás', async () => {
      const ok = vi.fn();
      const reject = vi.fn(() => Promise.reject(new Error('async boom')));
      bus.on('foo:bar', reject);
      bus.on('foo:bar', ok);
      await bus.emit('foo:bar', { value: 1 });
      expect(ok).toHaveBeenCalled();
    });

    it('emit resuelve sin lanzar incluso si los handlers fallan', async () => {
      bus.on('foo:bar', () => {
        throw new Error('x');
      });
      await expect(bus.emit('foo:bar', { value: 1 })).resolves.toBeUndefined();
    });
  });

  describe('con transports', () => {
    it('llama a transport.send en cada emit', async () => {
      const transport = mockTransport();
      const busT = new EventBus<TestEvents>({
        logger: silentLogger(),
        transports: [transport],
      });
      await busT.emit('foo:bar', { value: 7 });
      expect(transport.send).toHaveBeenCalledOnce();
      expect(transport.send).toHaveBeenCalledWith('foo:bar', { value: 7 });
    });

    it('reinyecta eventos del transport a handlers locales', async () => {
      const transport = mockTransport();
      const busT = new EventBus<TestEvents>({
        logger: silentLogger(),
        transports: [transport],
      });
      const handler = vi.fn();
      busT.on('foo:bar', handler);

      // El bus se suscribió al transport vía onReceive; recuperamos
      // ese receiver y simulamos un evento entrante.
      const receiver = transport.__getReceiver();
      expect(receiver).toBeDefined();
      await receiver?.('foo:bar', { value: 99 });

      expect(handler).toHaveBeenCalledWith({ value: 99 });
    });

    it('error en transport.send no rompe el emit local', async () => {
      const transport: ITransport = {
        id: 'flaky',
        send: vi.fn(() => Promise.reject(new Error('net down'))),
        onReceive: vi.fn(),
        close: vi.fn(() => Promise.resolve()),
      };
      const busT = new EventBus<TestEvents>({
        logger: silentLogger(),
        transports: [transport],
      });
      const handler = vi.fn();
      busT.on('foo:bar', handler);
      await busT.emit('foo:bar', { value: 1 });
      // El handler local recibió el evento aunque el transport falló.
      expect(handler).toHaveBeenCalled();
    });

    it('despacha a varios transports en paralelo', async () => {
      const t1 = mockTransport('t1');
      const t2 = mockTransport('t2');
      const busT = new EventBus<TestEvents>({
        logger: silentLogger(),
        transports: [t1, t2],
      });
      await busT.emit('foo:bar', { value: 5 });
      expect(t1.send).toHaveBeenCalledWith('foo:bar', { value: 5 });
      expect(t2.send).toHaveBeenCalledWith('foo:bar', { value: 5 });
    });
  });
});
