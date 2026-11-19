import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@proyecto-shiro/core';
import {
  installProcessSafetyNet,
  type ProcessSafetyNetOptions,
} from '../../src/process-safety-net.js';

function setup(overrides: ProcessSafetyNetOptions = {}): {
  proc: EventEmitter;
  exit: ReturnType<typeof vi.fn>;
  logged: ReturnType<typeof vi.spyOn>;
  uninstall: () => void;
} {
  const proc = new EventEmitter();
  const exit = vi.fn();
  const logger = new Logger('error', { module: 'safety-net-test' });
  const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  const uninstall = installProcessSafetyNet(logger, {
    proc,
    exit,
    // Por defecto el volcado avisa en el acto; los tests de espera lo cambian.
    flush: (done) => {
      done();
    },
    ...overrides,
  });
  return { proc, exit, logged, uninstall };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('installProcessSafetyNet', () => {
  it('una promesa rechazada sin manejar se registra y el proceso sigue', () => {
    const { proc, exit, logged } = setup();
    const err = new Error('fuera', { cause: new Error('dentro') });

    proc.emit('unhandledRejection', err);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[1]).toEqual({ err });
    expect(exit).not.toHaveBeenCalled();
  });

  it('una excepción sin capturar se registra y después el proceso sale con código 1', () => {
    const { proc, exit, logged } = setup();
    const err = new Error('rota');

    proc.emit('uncaughtException', err);

    expect(logged.mock.calls[0]?.[1]).toEqual({ err });
    expect(exit).toHaveBeenCalledWith(1);
    expect(logged.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0] ?? 0);
  });

  it('con un Logger real, la línea del log lleva también la causa', () => {
    const out = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const proc = new EventEmitter();
    installProcessSafetyNet(new Logger('error'), { proc, exit: vi.fn() });

    proc.emit('unhandledRejection', new Error('fuera', { cause: new Error('dentro') }));

    expect(String(out.mock.calls[0]?.[0])).toContain('fuera');
    expect(String(out.mock.calls[0]?.[0])).toContain('dentro');
  });

  it('si registrar falla, la excepción sin capturar sale igualmente con código 1', () => {
    const { proc, exit, logged } = setup();
    logged.mockImplementation(() => {
      throw new Error('EPIPE');
    });

    expect(() => proc.emit('uncaughtException', new Error('rota'))).not.toThrow();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('si registrar falla, el manejador de rechazos no lanza', () => {
    const { proc, exit, logged } = setup();
    logged.mockImplementation(() => {
      throw new Error('EPIPE');
    });

    expect(() => proc.emit('unhandledRejection', new Error('suelta'))).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });

  it('no sale hasta que lo escrito en el log ha salido', () => {
    let flushed: (() => void) | undefined;
    const { proc, exit } = setup({
      flush: (done) => {
        flushed = done;
      },
    });

    proc.emit('uncaughtException', new Error('rota'));
    expect(exit).not.toHaveBeenCalled();

    flushed?.();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('si el volcado no avisa nunca, sale igualmente al agotar el tiempo', () => {
    vi.useFakeTimers();
    const { proc, exit } = setup({ flush: () => undefined });

    proc.emit('uncaughtException', new Error('rota'));
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('una razón que no es un Error se registra como Error, sin volcar el objeto', () => {
    const { proc, logged } = setup();

    proc.emit('unhandledRejection', { status: 500, headers: { authorization: 'Bearer secreto' } });
    proc.emit('unhandledRejection', undefined);
    proc.emit('unhandledRejection', 'texto suelto');

    const errors = logged.mock.calls.map((call) => (call[1] as { err: unknown }).err);
    expect(errors.every((err) => err instanceof Error)).toBe(true);
    expect((errors[0] as Error).message).toContain('[object]');
    expect((errors[1] as Error).message).toContain('undefined');
    expect((errors[2] as Error).message).toContain('texto suelto');
    expect(JSON.stringify(errors.map((err) => (err as Error).message))).not.toContain('secreto');
  });

  it('durante el arranque, una promesa rechazada sin manejar también cierra el proceso', () => {
    let ready = false;
    const { proc, exit, logged } = setup({ isReady: () => ready });

    proc.emit('unhandledRejection', new Error('arranque a medias'));
    expect(logged).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);

    exit.mockClear();
    ready = true;
    proc.emit('unhandledRejection', new Error('ya en marcha'));
    expect(exit).not.toHaveBeenCalled();
  });

  it('la función que devuelve quita los dos manejadores', () => {
    const { proc, uninstall } = setup();
    expect(proc.listenerCount('unhandledRejection')).toBe(1);
    expect(proc.listenerCount('uncaughtException')).toBe(1);

    uninstall();

    expect(proc.listenerCount('unhandledRejection')).toBe(0);
    expect(proc.listenerCount('uncaughtException')).toBe(0);
  });
});
