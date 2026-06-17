/**
 * Tests del EvalRunner (ADR 0023 §6). La lógica (orden, parar en el primer
 * fallo, agregación) se testea con un `CommandRunner` mockeado — sin spawnear
 * npm. La ejecución real de `npm run` la cubre el ShellExecTool del ADR 0022.
 */

import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@proyecto-shiro/core';
import { parseSelfDevConfig } from '@proyecto-shiro/core/node';
import {
  EvalRunner,
  createEvalRunner,
  type CommandRunner,
} from '../../../src/selfdev/eval-runner.js';

function logger(): Logger {
  return new Logger('error', { module: 'test' });
}

describe('EvalRunner', () => {
  it('todos los checks verdes → ok, en orden', async () => {
    const run: CommandRunner = vi.fn(() => Promise.resolve({ ok: true, output: 'ok' }));
    const r = await new EvalRunner({
      commands: ['format:check', 'lint', 'typecheck', 'test'],
      run,
      logger: logger(),
    }).run();
    expect(r.ok).toBe(true);
    expect(r.passed).toEqual(['format:check', 'lint', 'typecheck', 'test']);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('para en el primer fallo y reporta el comando + su salida', async () => {
    const run: CommandRunner = vi.fn((script: string) =>
      Promise.resolve(
        script === 'lint'
          ? { ok: false, output: 'lint error en foo.ts' }
          : { ok: true, output: 'ok' },
      ),
    );
    const r = await new EvalRunner({
      commands: ['format:check', 'lint', 'typecheck', 'test'],
      run,
      logger: logger(),
    }).run();
    expect(r.ok).toBe(false);
    expect(r.failed).toBe('lint');
    expect(r.output).toContain('lint error');
    expect(r.passed).toEqual(['format:check']);
    // No corre typecheck ni test tras el fallo de lint.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lista de comandos vacía → ok trivial sin ejecutar nada', async () => {
    const run: CommandRunner = vi.fn(() => Promise.resolve({ ok: true, output: '' }));
    const r = await new EvalRunner({ commands: [], run, logger: logger() }).run();
    expect(r.ok).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('createEvalRunner', () => {
  it('toma los eval_commands de la config', () => {
    const runner = createEvalRunner({
      worktreePath: '/tmp/shiro-selfdev',
      config: parseSelfDevConfig({ eval_commands: ['typecheck', 'test'] }),
      logger: logger(),
    });
    expect(runner).toBeInstanceOf(EvalRunner);
    expect(runner.commands).toEqual(['typecheck', 'test']);
  });
});
