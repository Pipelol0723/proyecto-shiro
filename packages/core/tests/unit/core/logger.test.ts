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
});
