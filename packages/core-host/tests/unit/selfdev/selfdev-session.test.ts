/**
 * Tests del orquestador `SelfDevSession`: ejercita la secuencia, el fix-loop y
 * los gates con `SelfDevSteps` fakes (sin git/LLM/gh reales). Verifica las
 * garantías estructurales: NO se abre PR con el eval rojo, NO se limpia el
 * worktree salvo en éxito, y cada final emite `selfdev:done`.
 */

import { describe, expect, it, vi } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import {
  SelfDevSession,
  type SelfDevSteps,
  type SelfDevSessionOptions,
} from '../../../src/selfdev/selfdev-session.js';

function makeSteps(
  overrides: Partial<SelfDevSteps> = {},
): { [K in keyof SelfDevSteps]: ReturnType<typeof vi.fn> } & SelfDevSteps {
  const base: SelfDevSteps = {
    setup: vi.fn(() => Promise.resolve({ ok: true, branch: 'shiro/test' })),
    generate: vi.fn(() => Promise.resolve({ ok: true, summary: 'cambié foo.ts' })),
    verify: vi.fn(() => Promise.resolve({ ok: true, output: 'OK' })),
    diff: vi.fn(() => Promise.resolve(' packages/core/src/foo.ts | 2 +-\n')),
    commitAndPush: vi.fn(() => Promise.resolve({ ok: true, output: 'pushed' })),
    requestPrApproval: vi.fn(() => Promise.resolve(true)),
    createPr: vi.fn(() => Promise.resolve({ ok: true, url: 'https://github.com/o/r/pull/7' })),
    cleanup: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return base as never;
}

interface Harness {
  session: SelfDevSession;
  steps: ReturnType<typeof makeSteps>;
  announce: ReturnType<typeof vi.fn>;
  done: EventMap['selfdev:done'][];
  progress: EventMap['selfdev:progress'][];
  bus: IEventBus<EventMap>;
}

function harness(opts: { steps?: Partial<SelfDevSteps>; maxFix?: number } = {}): Harness {
  const logger = new Logger('error', { module: 'test' });
  const bus = new EventBus<EventMap>({ logger });
  const done: EventMap['selfdev:done'][] = [];
  const progress: EventMap['selfdev:progress'][] = [];
  bus.on('selfdev:done', (p) => {
    done.push(p);
  });
  bus.on('selfdev:progress', (p) => {
    progress.push(p);
  });
  const steps = makeSteps(opts.steps);
  const announce = vi.fn();
  const sessionOpts: SelfDevSessionOptions = {
    bus,
    logger,
    maxFixIterations: opts.maxFix ?? 2,
    steps,
    announce,
  };
  return { session: new SelfDevSession(sessionOpts), steps, announce, done, progress, bus };
}

describe('SelfDevSession happy path', () => {
  it('setup → generar → eval verde → commit → PR aprobado → cleanup + done ok', async () => {
    const h = harness();
    await h.session.run('arreglar el lip-sync');

    expect(h.steps.generate).toHaveBeenCalledTimes(1);
    expect(h.steps.commitAndPush).toHaveBeenCalledTimes(1);
    expect(h.steps.createPr).toHaveBeenCalledTimes(1);
    expect(h.steps.cleanup).toHaveBeenCalledTimes(1);
    expect(h.done).toHaveLength(1);
    expect(h.done[0]).toMatchObject({ ok: true, prUrl: 'https://github.com/o/r/pull/7' });
    expect(h.announce).toHaveBeenCalledTimes(1);
    expect(h.announce.mock.calls[0]?.[0]).toContain('/pull/7');
    // Fases emitidas en orden.
    expect(h.progress.map((p) => p.phase)).toEqual(['setup', 'generating', 'eval', 'pr', 'done']);
  });
});

describe('SelfDevSession fix-loop', () => {
  it('eval rojo una vez → regenera → verde → abre PR', async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, output: 'lint error en foo.ts', failed: 'lint' })
      .mockResolvedValueOnce({ ok: true, output: 'OK' });
    const h = harness({ steps: { verify } });
    await h.session.run('refactor');

    expect(h.steps.generate).toHaveBeenCalledTimes(2);
    // La segunda generación recibe el feedback del eval fallido.
    expect(h.steps.generate.mock.calls[1]?.[0]).toMatchObject({ feedback: 'lint error en foo.ts' });
    expect(h.steps.createPr).toHaveBeenCalledTimes(1);
    expect(h.done[0]).toMatchObject({ ok: true });
    expect(h.progress.map((p) => p.phase)).toContain('fixing');
  });

  it('eval rojo tras maxFixIterations → NO abre PR, NO limpia, deja la rama', async () => {
    const verify = vi.fn(() =>
      Promise.resolve({ ok: false, output: 'typecheck roto', failed: 'typecheck' }),
    );
    const h = harness({ steps: { verify }, maxFix: 2 });
    await h.session.run('cambio imposible');

    expect(h.steps.generate).toHaveBeenCalledTimes(3); // intento 0 + 2 fixes
    expect(h.steps.verify).toHaveBeenCalledTimes(3);
    expect(h.steps.commitAndPush).not.toHaveBeenCalled();
    expect(h.steps.createPr).not.toHaveBeenCalled();
    expect(h.steps.cleanup).not.toHaveBeenCalled();
    expect(h.done[0]).toMatchObject({ ok: false, branch: 'shiro/test' });
    expect(h.done[0]?.reason).toContain('eval');
  });
});

describe('SelfDevSession gates y bordes', () => {
  it('PR no aprobado → NO crea PR, NO limpia, deja la rama pusheada', async () => {
    const h = harness({ steps: { requestPrApproval: vi.fn(() => Promise.resolve(false)) } });
    await h.session.run('algo');

    expect(h.steps.commitAndPush).toHaveBeenCalledTimes(1);
    expect(h.steps.createPr).not.toHaveBeenCalled();
    expect(h.steps.cleanup).not.toHaveBeenCalled();
    expect(h.done[0]).toMatchObject({ ok: false, branch: 'shiro/test' });
  });

  it('sin cambios (diff vacío) → aborta sin commit ni PR', async () => {
    const h = harness({ steps: { diff: vi.fn(() => Promise.resolve('   \n')) } });
    await h.session.run('nada');

    expect(h.steps.commitAndPush).not.toHaveBeenCalled();
    expect(h.steps.createPr).not.toHaveBeenCalled();
    expect(h.done[0]).toMatchObject({ ok: false });
  });

  it('setup falla → aborta antes de generar', async () => {
    const h = harness({
      steps: {
        setup: vi.fn(() => Promise.resolve({ ok: false, branch: '', error: 'git fetch falló' })),
      },
    });
    await h.session.run('x');

    expect(h.steps.generate).not.toHaveBeenCalled();
    expect(h.done[0]).toMatchObject({ ok: false });
    expect(h.done[0]?.reason).toContain('worktree');
  });

  it('createPr falla → done ok:false, rama queda (sin cleanup)', async () => {
    const h = harness({
      steps: { createPr: vi.fn(() => Promise.resolve({ ok: false, error: 'gh: no auth' })) },
    });
    await h.session.run('x');

    expect(h.steps.cleanup).not.toHaveBeenCalled();
    expect(h.done[0]).toMatchObject({ ok: false });
    expect(h.done[0]?.reason).toContain('gh pr create');
  });

  it('una excepción inesperada termina en done ok:false (no propaga)', async () => {
    const h = harness({ steps: { verify: vi.fn(() => Promise.reject(new Error('boom'))) } });
    await expect(h.session.run('x')).resolves.toBeUndefined();
    expect(h.done[0]).toMatchObject({ ok: false, reason: 'boom' });
  });
});

describe('SelfDevSession concurrencia', () => {
  it('ignora un run() concurrente mientras hay uno en curso', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const setup = vi.fn(async () => {
      await gate;
      return { ok: true, branch: 'shiro/test' };
    });
    const h = harness({ steps: { setup } });

    const first = h.session.run('a');
    expect(h.session.isRunning()).toBe(true);
    await h.session.run('b'); // debe salir de inmediato (ignorado)
    expect(setup).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(h.session.isRunning()).toBe(false);
  });
});
