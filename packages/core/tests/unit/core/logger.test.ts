import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { Logger } from '../../../src/core/logger.js';

describe('Logger', () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  let stderrWrite: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('levels', () => {
    it('emite un mensaje debug si el threshold es debug', () => {
      const logger = new Logger('debug');
      logger.debug('hello');
      expect(stdoutWrite).toHaveBeenCalledOnce();
    });

    it('filtra debug cuando el threshold es info', () => {
      const logger = new Logger('info');
      logger.debug('hello');
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('filtra info cuando el threshold es warn', () => {
      const logger = new Logger('warn');
      logger.info('hello');
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('rutea warn y error a stderr', () => {
      const logger = new Logger('debug');
      logger.warn('careful');
      logger.error('boom');
      expect(stderrWrite).toHaveBeenCalledTimes(2);
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('rutea debug e info a stdout', () => {
      const logger = new Logger('debug');
      logger.debug('hello');
      logger.info('hi');
      expect(stdoutWrite).toHaveBeenCalledTimes(2);
      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });

  describe('format', () => {
    it('incluye timestamp ISO, nivel y mensaje', () => {
      const logger = new Logger('info');
      logger.info('hello');
      const line = stdoutWrite.mock.calls[0]?.[0] as string;
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(line).toContain('INFO');
      expect(line).toContain('hello');
      expect(line).toMatch(/\n$/); // termina en newline
    });

    it('serializa el payload como JSON', () => {
      const logger = new Logger('info');
      logger.info('event', { foo: 'bar', n: 42 });
      const line = stdoutWrite.mock.calls[0]?.[0] as string;
      expect(line).toContain('"foo":"bar"');
      expect(line).toContain('"n":42');
    });

    it('omite el bloque de contexto si está vacío', () => {
      const logger = new Logger('info');
      logger.info('plain');
      const line = stdoutWrite.mock.calls[0]?.[0] as string;
      // Sin contexto no debe aparecer `[...]` antes del mensaje
      expect(line).not.toMatch(/\[\s*\]/);
    });
  });

  describe('child', () => {
    it('hereda el nivel del padre', () => {
      const parent = new Logger('warn');
      const child = parent.child({ module: 'Test' });
      child.info('should not appear');
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('añade el contexto al output', () => {
      const parent = new Logger('info');
      const child = parent.child({ module: 'EventBus' });
      child.info('handler registered');
      const line = stdoutWrite.mock.calls[0]?.[0] as string;
      expect(line).toContain('module=EventBus');
    });

    it('combina contexto anidado (padre + hijo)', () => {
      const root = new Logger('info', { app: 'shiro' });
      const child = root.child({ module: 'EventBus' });
      child.info('ready');
      const line = stdoutWrite.mock.calls[0]?.[0] as string;
      expect(line).toContain('app=shiro');
      expect(line).toContain('module=EventBus');
    });

    it('no muta al padre al crear el hijo', () => {
      const parent = new Logger('info');
      parent.child({ module: 'Test' });
      parent.info('parent log');
      const line = stdoutWrite.mock.calls[0]?.[0] as string;
      expect(line).not.toContain('module=Test');
    });
  });

  describe('env var LOG_LEVEL', () => {
    it('default es info si no está seteado', () => {
      vi.stubEnv('LOG_LEVEL', '');
      const logger = new Logger();
      logger.debug('should not appear');
      expect(stdoutWrite).not.toHaveBeenCalled();
    });

    it('respeta LOG_LEVEL=debug', () => {
      vi.stubEnv('LOG_LEVEL', 'debug');
      const logger = new Logger();
      logger.debug('appears');
      expect(stdoutWrite).toHaveBeenCalledOnce();
    });

    it('respeta LOG_LEVEL=error y filtra todo lo demás', () => {
      vi.stubEnv('LOG_LEVEL', 'error');
      const logger = new Logger();
      logger.warn('no');
      logger.info('no');
      logger.error('si');
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(stderrWrite).toHaveBeenCalledOnce();
    });

    it('cae a info para valores inválidos', () => {
      vi.stubEnv('LOG_LEVEL', 'verbose');
      const logger = new Logger();
      logger.debug('no aparece');
      expect(stdoutWrite).not.toHaveBeenCalled();
      logger.info('si aparece');
      expect(stdoutWrite).toHaveBeenCalledOnce();
    });
  });
});
