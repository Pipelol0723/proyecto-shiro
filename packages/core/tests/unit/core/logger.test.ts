import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { Logger } from '../../../src/core/logger.js';

/**
 * Tests del Logger universal.
 *
 * Sink: `console.{debug,info,warn,error}` (ver ADR 0011). En Node los
 * niveles debug/info van a stdout y warn/error a stderr — pero a nivel
 * de test lo que validamos es CUÁL método de console se llama, no
 * dónde escribe. Eso desacopla el test del entorno.
 */
describe('Logger', () => {
  let consoleDebug: MockInstance<typeof console.debug>;
  let consoleInfo: MockInstance<typeof console.info>;
  let consoleWarn: MockInstance<typeof console.warn>;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('levels', () => {
    it('emite un mensaje debug si el threshold es debug', () => {
      const logger = new Logger('debug');
      logger.debug('hello');
      expect(consoleDebug).toHaveBeenCalledOnce();
    });

    it('filtra debug cuando el threshold es info', () => {
      const logger = new Logger('info');
      logger.debug('hello');
      expect(consoleDebug).not.toHaveBeenCalled();
    });

    it('filtra info cuando el threshold es warn', () => {
      const logger = new Logger('warn');
      logger.info('hello');
      expect(consoleInfo).not.toHaveBeenCalled();
    });

    it('warn y error usan console.warn / console.error', () => {
      const logger = new Logger('debug');
      logger.warn('careful');
      logger.error('boom');
      expect(consoleWarn).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledOnce();
      expect(consoleDebug).not.toHaveBeenCalled();
      expect(consoleInfo).not.toHaveBeenCalled();
    });

    it('debug e info usan console.debug / console.info', () => {
      const logger = new Logger('debug');
      logger.debug('hello');
      logger.info('hi');
      expect(consoleDebug).toHaveBeenCalledOnce();
      expect(consoleInfo).toHaveBeenCalledOnce();
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('format', () => {
    it('incluye timestamp ISO, nivel y mensaje', () => {
      const logger = new Logger('info');
      logger.info('hello');
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(line).toContain('INFO');
      expect(line).toContain('hello');
    });

    it('serializa el payload como JSON', () => {
      const logger = new Logger('info');
      logger.info('event', { foo: 'bar', n: 42 });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('"foo":"bar"');
      expect(line).toContain('"n":42');
    });

    it('omite el bloque de contexto si está vacío', () => {
      const logger = new Logger('info');
      logger.info('plain');
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      // Sin contexto no debe aparecer `[...]` antes del mensaje
      expect(line).not.toMatch(/\[\s*\]/);
    });
  });

  describe('child', () => {
    it('hereda el nivel del padre', () => {
      const parent = new Logger('warn');
      const child = parent.child({ module: 'Test' });
      child.info('should not appear');
      expect(consoleInfo).not.toHaveBeenCalled();
    });

    it('añade el contexto al output', () => {
      const parent = new Logger('info');
      const child = parent.child({ module: 'EventBus' });
      child.info('handler registered');
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('module=EventBus');
    });

    it('combina contexto anidado (padre + hijo)', () => {
      const root = new Logger('info', { app: 'shiro' });
      const child = root.child({ module: 'EventBus' });
      child.info('ready');
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('app=shiro');
      expect(line).toContain('module=EventBus');
    });

    it('no muta al padre al crear el hijo', () => {
      const parent = new Logger('info');
      parent.child({ module: 'Test' });
      parent.info('parent log');
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).not.toContain('module=Test');
    });
  });

  describe('env var LOG_LEVEL', () => {
    it('default es info si no está seteado', () => {
      vi.stubEnv('LOG_LEVEL', '');
      const logger = new Logger();
      logger.debug('should not appear');
      expect(consoleDebug).not.toHaveBeenCalled();
    });

    it('respeta LOG_LEVEL=debug', () => {
      vi.stubEnv('LOG_LEVEL', 'debug');
      const logger = new Logger();
      logger.debug('appears');
      expect(consoleDebug).toHaveBeenCalledOnce();
    });

    it('respeta LOG_LEVEL=error y filtra todo lo demás', () => {
      vi.stubEnv('LOG_LEVEL', 'error');
      const logger = new Logger();
      logger.warn('no');
      logger.info('no');
      logger.error('si');
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleInfo).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledOnce();
    });

    it('cae a info para valores inválidos', () => {
      vi.stubEnv('LOG_LEVEL', 'verbose');
      const logger = new Logger();
      logger.debug('no aparece');
      expect(consoleDebug).not.toHaveBeenCalled();
      logger.info('si aparece');
      expect(consoleInfo).toHaveBeenCalledOnce();
    });
  });

  describe('errores', () => {
    /** Extrae y parsea el JSON del payload de la línea emitida (tras el mensaje `x`). */
    function parsePayload(line: string): Record<string, unknown> {
      return JSON.parse(line.slice(line.indexOf(' x ') + 3)) as Record<string, unknown>;
    }

    it('serializa un Error con name, message y stack', () => {
      const logger = new Logger('info');
      logger.info('x', { err: new Error('detalle') });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('"message":"detalle"');
      expect(line).toContain('"name":"Error"');
      expect(line).toContain('"stack":"Error: detalle');
    });

    it('serializa la cadena cause de un Error anidado', () => {
      const logger = new Logger('info');
      logger.info('x', { err: new Error('fuera', { cause: new Error('dentro') }) });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      const err = parsePayload(line).err as { message: string; cause: { message: string } };
      expect(err.message).toBe('fuera');
      expect(err.cause.message).toBe('dentro');
    });

    it('conserva name y propiedades primitivas de un error propio', () => {
      class OllamaLLMError extends Error {
        readonly code = 'ECONNREFUSED';
        readonly headers = { authorization: 'secreto' };
        constructor(message: string) {
          super(message);
          this.name = 'OllamaLLMError';
        }
      }
      const logger = new Logger('info');
      logger.info('x', { err: new OllamaLLMError('sin conexión') });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('"name":"OllamaLLMError"');
      expect(line).toContain('"code":"ECONNREFUSED"');
      // Los objetos propios no se vuelcan (podrían llevar secretos).
      expect(line).not.toContain('secreto');
    });

    it('no entra en bucle con una cause circular', () => {
      const a = new Error('a');
      const b = new Error('b');
      a.cause = b;
      b.cause = a;
      const logger = new Logger('info');
      expect(() => logger.info('x', { err: a })).not.toThrow();
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('[circular]');
    });

    it('limita la profundidad de la cadena cause', () => {
      let err = new Error('nivel-9');
      for (let i = 8; i >= 0; i--) err = new Error(`nivel-${i}`, { cause: err });
      const logger = new Logger('info');
      logger.info('x', { err });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('nivel-0');
      expect(line).toContain('nivel-3');
      expect(line).not.toContain('nivel-4');
      expect(line).toContain('"cause":"[truncated]"');
    });

    it('no vuelca una cause que no es Error (podría llevar secretos)', () => {
      const err = new Error('c', { cause: { headers: { authorization: 'secreto' } } });
      const logger = new Logger('info');
      logger.info('x', { err });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).not.toContain('secreto');
      expect(line).toContain('"message":"c"');
    });

    it('una cause objeto que apunta al error no pierde el message', () => {
      const c = new Error('c');
      c.cause = { inner: c };
      const logger = new Logger('info');
      logger.info('x', { err: c });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).not.toContain('[unserializable]');
      expect(line).toContain('"message":"c"');
    });

    it('no vuelca objetos dentro de AggregateError.errors', () => {
      const err = new AggregateError([{ k: 'secreto' }, new Error('hijo')], 'varios');
      const logger = new Logger('info');
      logger.info('x', { err });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).not.toContain('secreto');
      expect(line).toContain('hijo');
    });

    it('recorta las cadenas largas de propiedades propias', () => {
      const err = Object.assign(new Error('e'), { detail: 'x'.repeat(5000) });
      const logger = new Logger('info');
      logger.info('x', { err });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain(`${'x'.repeat(500)}…`);
      expect(line).not.toContain('x'.repeat(501));
    });

    it('recorta el stack a MAX_STACK_LINES líneas', () => {
      const err = new Error('largo');
      err.stack = Array.from({ length: 40 }, (_, i) => `linea-${i}`).join('\n');
      const logger = new Logger('info');
      logger.info('x', { err });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      const stack = (parsePayload(line).err as { stack: string }).stack;
      expect(stack.split('\n').length).toBe(10);
      expect(stack).toContain('linea-0');
      expect(stack).not.toContain('linea-39');
    });

    it('serializa los errores de un AggregateError como lista', () => {
      const logger = new Logger('info');
      logger.info('x', { err: new AggregateError([new Error('uno'), new Error('dos')], 'varios') });
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('"message":"uno"');
      expect(line).toContain('"message":"dos"');
    });

    it('serializa un Error puesto en el contexto de child()', () => {
      const logger = new Logger('info').child({ err: new Error('ctx-detalle') });
      logger.info('x');
      const line = consoleInfo.mock.calls[0]?.[0] as string;
      expect(line).toContain('"message":"ctx-detalle"');
    });
  });
});
