/**
 * Selector de motores del avatar (ADR 0028 §3): lista ordenada de candidatos,
 * comprobación con tiempo límite y el orbe como último recurso.
 *
 * Los casos son los de `docs/design/chibi-prototype/expected-behaviors.md` §7.
 * Los motores son falsos: aquí se prueba quién se monta, no qué dibuja.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Avatar } from '../../src/components/Avatar/Avatar';
import { PROBE_TIMEOUT_MS, selectEngine } from '../../src/components/Avatar/engines/select';
import type {
  AvatarCandidate,
  AvatarEngineDefinition,
  AvatarEngineProps,
} from '../../src/components/Avatar/engines/types';

type Probe = AvatarEngineDefinition['probe'];

/** Motor falso: pinta su `kind` y deja a mano su `onLoadError`. */
function fakeEngine(
  kind: string,
  probe: Probe,
  options: { loadFails?: boolean; throwsOnRender?: boolean } = {},
): AvatarEngineDefinition & {
  probe: ReturnType<typeof vi.fn<Probe>>;
  fail: (err: unknown) => void;
} {
  let onLoadError: ((err: unknown) => void) | undefined;
  function Fake(props: AvatarEngineProps): JSX.Element {
    if (options.throwsOnRender === true) throw new Error('boom');
    onLoadError = props.onLoadError;
    return <div data-testid={`engine-${kind}`} />;
  }
  return {
    kind,
    probe: vi.fn(probe),
    load: () =>
      options.loadFails === true ? Promise.reject(new Error('sin chunk')) : Promise.resolve(Fake),
    fail: (err) => {
      onLoadError?.(err);
    },
  };
}

const yes: Probe = () => Promise.resolve(true);
const no: Probe = () => Promise.resolve(false);
const never: Probe = () => new Promise<boolean>(() => undefined);
const candidate = (kind: string): AvatarCandidate => ({ kind });

afterEach(() => {
  vi.useRealTimers();
});

describe('selectEngine', () => {
  const signal = (): AbortSignal => new AbortController().signal;

  it('elige el primer candidato disponible y no comprueba el resto', async () => {
    const a = fakeEngine('a', yes);
    const b = fakeEngine('b', yes);

    const result = await selectEngine([candidate('a'), candidate('b')], [a, b], {
      signal: signal(),
    });

    expect(result?.candidate.kind).toBe('a');
    expect(result?.index).toBe(0);
    expect(b.probe).not.toHaveBeenCalled();
  });

  it.each([
    ['la comprobación dice que no', fakeEngine('a', no)],
    ['la comprobación lanza', fakeEngine('a', () => Promise.reject(new Error('red')))],
    ['el motor no se puede cargar', fakeEngine('a', yes, { loadFails: true })],
  ])('pasa al siguiente si %s', async (_name, a) => {
    const b = fakeEngine('b', yes);
    const result = await selectEngine([candidate('a'), candidate('b')], [a, b], {
      signal: signal(),
    });
    expect(result?.candidate.kind).toBe('b');
    expect(result?.index).toBe(1);
  });

  it('salta un candidato cuyo motor no conoce', async () => {
    const b = fakeEngine('b', yes);
    const result = await selectEngine([candidate('raro'), candidate('b')], [b], {
      signal: signal(),
    });
    expect(result?.candidate.kind).toBe('b');
  });

  it('con todos fallando, o sin candidatos, no elige ninguno', async () => {
    const a = fakeEngine('a', no);
    expect(await selectEngine([candidate('a')], [a], { signal: signal() })).toBeNull();
    expect(await selectEngine([], [a], { signal: signal() })).toBeNull();
  });

  it('una comprobación que no responde se abandona al agotar el tiempo', async () => {
    vi.useFakeTimers();
    let probeSignal: AbortSignal | undefined;
    const a = fakeEngine('a', (_candidate, s) => {
      probeSignal = s;
      return new Promise<boolean>(() => undefined);
    });
    const b = fakeEngine('b', yes);

    const pending = selectEngine([candidate('a'), candidate('b')], [a, b], { signal: signal() });
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(b.probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect((await pending)?.candidate.kind).toBe('b');
    expect(probeSignal?.aborted).toBe(true);
  });

  it('una respuesta que llega tarde se ignora', async () => {
    vi.useFakeTimers();
    let answerLate: ((ok: boolean) => void) | undefined;
    const a = fakeEngine(
      'a',
      () =>
        new Promise<boolean>((resolve) => {
          answerLate = resolve;
        }),
    );
    const b = fakeEngine('b', yes);

    const pending = selectEngine([candidate('a'), candidate('b')], [a, b], { signal: signal() });
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    answerLate?.(true);

    expect((await pending)?.candidate.kind).toBe('b');
  });

  it('empieza por donde se le diga, para seguir tras un fallo', async () => {
    const a = fakeEngine('a', yes);
    const b = fakeEngine('b', yes);
    const result = await selectEngine([candidate('a'), candidate('b')], [a, b], {
      from: 1,
      signal: signal(),
    });
    expect(result?.candidate.kind).toBe('b');
    expect(a.probe).not.toHaveBeenCalled();
  });

  it('si se cancela a mitad, no elige nada ni sigue comprobando', async () => {
    const controller = new AbortController();
    const a = fakeEngine('a', () => {
      controller.abort();
      return Promise.resolve(false);
    });
    const b = fakeEngine('b', yes);

    const result = await selectEngine([candidate('a'), candidate('b')], [a, b], {
      signal: controller.signal,
    });

    expect(result).toBeNull();
    expect(b.probe).not.toHaveBeenCalled();
  });
});

describe('<Avatar /> con candidatos', () => {
  const rendered = (container: HTMLElement): string | null | undefined =>
    container.querySelector('[data-render]')?.getAttribute('data-render');

  it('mientras se comprueba un candidato se ve el orbe', () => {
    const { container } = render(
      <Avatar candidates={[candidate('a')]} engines={[fakeEngine('a', never)]} />,
    );
    expect(rendered(container)).toBe('orb');
  });

  it('monta el primer motor disponible', async () => {
    const { container } = render(
      <Avatar
        candidates={[candidate('live2d'), candidate('capas')]}
        engines={[fakeEngine('live2d', no), fakeEngine('capas', yes)]}
      />,
    );
    await waitFor(() => {
      expect(rendered(container)).toBe('capas');
    });
    expect(screen.queryByTestId('engine-capas')).not.toBeNull();
  });

  it('sin candidatos, o con todos fallando, se queda en el orbe', async () => {
    const a = fakeEngine('a', no);
    const { container } = render(<Avatar candidates={[candidate('a')]} engines={[a]} />);
    await waitFor(() => {
      expect(a.probe).toHaveBeenCalled();
    });
    expect(rendered(container)).toBe('orb');

    const empty = render(<Avatar candidates={[]} engines={[a]} />);
    expect(rendered(empty.container)).toBe('orb');
  });

  it('si el motor falla después de montado, pasa al siguiente y al final al orbe', async () => {
    const a = fakeEngine('a', yes);
    const b = fakeEngine('b', yes);
    const { container } = render(
      <Avatar candidates={[candidate('a'), candidate('b')]} engines={[a, b]} />,
    );
    await waitFor(() => {
      expect(rendered(container)).toBe('a');
    });

    act(() => {
      a.fail(new Error('texturas 404'));
    });
    await waitFor(() => {
      expect(rendered(container)).toBe('b');
    });
    expect(a.probe).toHaveBeenCalledTimes(1);

    act(() => {
      b.fail(new Error('también'));
    });
    await waitFor(() => {
      expect(rendered(container)).toBe('orb');
    });
  });

  it('si el motor lanza al pintar, pasa al siguiente', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(
      <Avatar
        candidates={[candidate('a'), candidate('b')]}
        engines={[fakeEngine('a', yes, { throwsOnRender: true }), fakeEngine('b', yes)]}
      />,
    );
    await waitFor(() => {
      expect(rendered(container)).toBe('b');
    });
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('al desmontar a mitad de una comprobación la cancela y no monta nada', async () => {
    let probeSignal: AbortSignal | undefined;
    let answer: ((ok: boolean) => void) | undefined;
    const a = fakeEngine('a', (_candidate, s) => {
      probeSignal = s;
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    });
    const { unmount } = render(<Avatar candidates={[candidate('a')]} engines={[a]} />);
    await waitFor(() => {
      expect(a.probe).toHaveBeenCalled();
    });

    unmount();
    expect(probeSignal?.aborted).toBe(true);

    answer?.(true);
    await Promise.resolve();
    expect(screen.queryByTestId('engine-a')).toBeNull();
  });
});
