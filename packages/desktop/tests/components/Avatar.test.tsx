/**
 * Tests del `<Avatar>` — wrapper que decide Live2D vs Orbe.
 *
 * Estrategia:
 *
 *  - Stub de `fetch` para controlar HEAD del `.model3.json` (200 vs error).
 *  - Mock del módulo `./cubism-core` para controlar si el SDK "carga" o no.
 *  - Mock del `./Live2DCanvas` para no levantar PIXI en jsdom (WebGL no
 *    funciona ahí).
 *
 * Lo que verificamos:
 *
 *  1. Estado `pending` inicial → Orbe (no flash visual).
 *  2. Modelo no alcanzable → Orbe persiste (`data-render="orb"`).
 *  3. Modelo alcanzable + SDK falla → Orbe persiste.
 *  4. Modelo alcanzable + SDK ok → swap a Live2D (`data-render="live2d"`).
 *  5. Si el canvas notifica `onLoadError` tras montar → vuelve a Orbe.
 *
 * NO testea el render real del modelo Live2D — WebGL no funciona en
 * jsdom. La verificación visual de que Hiyori aparece, las expresiones
 * cambian, etc., es manual por el usuario en cada PR del hito (ADR 0021 §8).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Avatar } from '../../src/components/Avatar/Avatar';
import { __resetCubismCoreCache } from '../../src/components/Avatar/cubism-core';

// Mock del canvas: render un placeholder simple, expone el onLoadError
// para el test que verifica el fallback a posteriori. Si `canvasShouldThrow`
// está activo, lanza EN RENDER — simula el crash de pixi-live2d-display en la
// WebView empaquetada que debe atrapar el ErrorBoundary.
let capturedOnLoadError: ((err: unknown) => void) | undefined;
let canvasShouldThrow = false;

vi.mock('../../src/components/Avatar/Live2DCanvas', () => {
  return {
    Live2DCanvas: (props: { size: number; onLoadError?: (err: unknown) => void }): JSX.Element => {
      if (canvasShouldThrow) throw new Error('pixi render boom');
      capturedOnLoadError = props.onLoadError;
      return <div data-testid="live2d-canvas" style={{ width: props.size, height: props.size }} />;
    },
  };
});

vi.mock('../../src/components/Avatar/cubism-core', () => {
  return {
    ensureCubismCore: vi.fn(),
    __resetCubismCoreCache: vi.fn(),
  };
});

import { ensureCubismCore } from '../../src/components/Avatar/cubism-core';

const ensureCubismCoreMock = vi.mocked(ensureCubismCore);
const fetchMock = vi.fn();
const NEVER_RESOLVES = (): Promise<never> => new Promise<never>(() => undefined);

beforeEach(() => {
  capturedOnLoadError = undefined;
  canvasShouldThrow = false;
  ensureCubismCoreMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  __resetCubismCoreCache();
  vi.unstubAllGlobals();
});

function stubModelReachable(ok: boolean): void {
  fetchMock.mockResolvedValue({ ok });
}

describe('<Avatar /> fallback al Orbe', () => {
  it('renderiza el Orbe inmediatamente mientras detecta (estado pending)', () => {
    // Nunca resuelve — simula "detección en curso".
    fetchMock.mockImplementation(NEVER_RESOLVES);
    ensureCubismCoreMock.mockImplementation(NEVER_RESOLVES);

    const { container } = render(<Avatar emotion="neutral" size={200} />);
    const wrap = container.querySelector('[data-render]');
    expect(wrap?.getAttribute('data-render')).toBe('orb');
    expect(screen.queryByTestId('live2d-canvas')).toBeNull();
  });

  it('queda en Orbe cuando el modelo NO es alcanzable (HEAD !ok)', async () => {
    stubModelReachable(false);
    ensureCubismCoreMock.mockResolvedValue(true);

    const { container } = render(<Avatar emotion="divertida" size={200} />);
    await waitFor(() => {
      const wrap = container.querySelector('[data-render]');
      expect(wrap?.getAttribute('data-render')).toBe('orb');
    });
    expect(ensureCubismCoreMock).not.toHaveBeenCalled();
  });

  it('queda en Orbe cuando el fetch del HEAD lanza (sin red, CORS)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    ensureCubismCoreMock.mockResolvedValue(true);

    const { container } = render(<Avatar size={200} />);
    await waitFor(() => {
      const wrap = container.querySelector('[data-render]');
      expect(wrap?.getAttribute('data-render')).toBe('orb');
    });
  });

  it('queda en Orbe cuando el Cubism Core falla al cargar', async () => {
    stubModelReachable(true);
    ensureCubismCoreMock.mockResolvedValue(false);

    const { container } = render(<Avatar size={200} />);
    await waitFor(() => {
      const wrap = container.querySelector('[data-render]');
      expect(wrap?.getAttribute('data-render')).toBe('orb');
    });
    expect(ensureCubismCoreMock).toHaveBeenCalledTimes(1);
  });
});

describe('<Avatar /> swap a Live2D', () => {
  it('renderiza el canvas Live2D cuando modelo + SDK están disponibles', async () => {
    stubModelReachable(true);
    ensureCubismCoreMock.mockResolvedValue(true);

    const { container } = render(<Avatar size={240} />);
    await waitFor(() => {
      const wrap = container.querySelector('[data-render]');
      expect(wrap?.getAttribute('data-render')).toBe('live2d');
    });
    expect(screen.queryByTestId('live2d-canvas')).not.toBeNull();
  });

  it('cae al Orbe si el canvas Live2D LANZA al renderizar (ErrorBoundary)', async () => {
    // Regresión del white-screen en el binario: pixi-live2d-display crasheaba
    // en pleno render dentro de la WebView empaquetada. Sin boundary, ese
    // throw desmontaba toda la app. Ahora debe caer al Orbe.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubModelReachable(true);
    ensureCubismCoreMock.mockResolvedValue(true);
    canvasShouldThrow = true;

    const { container } = render(<Avatar size={240} />);

    await waitFor(() => {
      const wrap = container.querySelector('[data-render]');
      expect(wrap?.getAttribute('data-render')).toBe('orb');
    });
    expect(screen.queryByTestId('live2d-canvas')).toBeNull();

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('vuelve al Orbe si el canvas notifica onLoadError tras montar', async () => {
    stubModelReachable(true);
    ensureCubismCoreMock.mockResolvedValue(true);

    const { container } = render(<Avatar size={240} />);
    await waitFor(() => {
      expect(screen.queryByTestId('live2d-canvas')).not.toBeNull();
    });
    // El canvas mockeado captura el onLoadError vía closure.
    expect(capturedOnLoadError).toBeDefined();

    act(() => {
      capturedOnLoadError?.(new Error('texturas 404'));
    });

    await waitFor(() => {
      const wrap = container.querySelector('[data-render]');
      expect(wrap?.getAttribute('data-render')).toBe('orb');
    });
    expect(screen.queryByTestId('live2d-canvas')).toBeNull();
  });
});

describe('<Avatar /> props passthrough al Orbe', () => {
  it('propaga emotion al data-emotion del wrap', async () => {
    stubModelReachable(false);
    ensureCubismCoreMock.mockResolvedValue(false);

    const { container } = render(<Avatar emotion="molesta" size={200} />);
    await waitFor(() => {
      const wrap = container.querySelector('[data-render]');
      expect(wrap?.getAttribute('data-emotion')).toBe('molesta');
    });
  });
});
