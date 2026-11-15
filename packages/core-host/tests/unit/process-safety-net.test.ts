import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@proyecto-shiro/core';
import { installProcessSafetyNet } from '../../src/process-safety-net.js';

function setup(): {
  proc: EventEmitter;
  exit: ReturnType<typeof vi.fn>;
  logged: ReturnType<typeof vi.spyOn>;
  uninstall: () => void;
} {
  const proc = new EventEmitter();
  const exit = vi.fn();
  const logger = new Logger('error', { module: 'safety-net-test' });
  const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  const uninstall = installProcessSafetyNet(logger, { proc, exit });
  return { proc, exit, logged, uninstall };
}

describe('installProcessSafetyNet', () => {
  it('una promesa rechazada sin manejar se registra entera y el proceso sigue', () => {
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

  it('la función que devuelve quita los dos manejadores', () => {
    const { proc, uninstall } = setup();
    expect(proc.listenerCount('unhandledRejection')).toBe(1);
    expect(proc.listenerCount('uncaughtException')).toBe(1);

    uninstall();

    expect(proc.listenerCount('unhandledRejection')).toBe(0);
    expect(proc.listenerCount('uncaughtException')).toBe(0);
  });
});
