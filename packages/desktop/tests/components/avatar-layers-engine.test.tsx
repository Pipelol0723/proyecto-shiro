/**
 * Motor de capas montado en la app (ADR 0028 §3 y §4): el lienzo que dibuja a
 * la chibi, su alta como motor del selector y la lista de candidatos por
 * defecto.
 *
 * jsdom no pinta: el contexto 2D, el reloj de animación y la preferencia de
 * «reducir movimiento» son dobles. Lo que se comprueba es qué se pinta, cuándo
 * se deja de pintar y que no queda nada abierto. Que la chibi se vea bien se
 * comprueba a mano en la app.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { Avatar } from '../../src/components/Avatar/Avatar';
import { AVATAR_CONFIG, CHIBI_MANIFEST_URL } from '../../src/components/Avatar/config';
import { LayersCanvas, MAX_FPS } from '../../src/components/Avatar/engines/layers/LayersCanvas';
import {
  LAYERS_KIND,
  layersCandidate,
  layersEngine,
} from '../../src/components/Avatar/engines/layers/engine';
import {
  LayersLoadError,
  type LoadedLayers,
} from '../../src/components/Avatar/engines/layers/loader';
import { parseSpriteLayersManifest } from '../../src/components/Avatar/engines/layers/manifest';
import type { LayerImage } from '../../src/components/Avatar/engines/layers/player';
import type { UseLipSyncOptions } from '../../src/components/Avatar/useLipSync';

// El audio real necesita un AudioContext, que jsdom no tiene: aquí solo se
// mira qué recibe el hook y qué pasa cuando entrega un nivel de voz.
let lipSync: UseLipSyncOptions | null = null;
vi.mock('../../src/components/Avatar/useLipSync', () => ({
  useLipSync: (options: UseLipSyncOptions): void => {
    lipSync = options;
  },
}));

const TEST_MODEL = path.resolve(__dirname, '../../../../docs/design/chibi-prototype/test-model');
const readModelFile = (name: string): Buffer => readFileSync(path.join(TEST_MODEL, name));
const FRAME_MS = 1000 / MAX_FPS;

// ── dobles del lienzo, del reloj y de la preferencia de movimiento ───────────

interface Call {
  op: 'draw' | 'clear' | 'scale';
  canvas: HTMLCanvasElement;
  image?: string;
  x?: number;
  y?: number;
}

let calls: Call[] = [];
/** Nombre de la imagen que «se rompe» al pintarla. */
let failDraw: string | null = null;
/** El navegador no da contexto 2D. */
let noContext = false;
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let reducedMotion = false;
let motionListeners = new Set<(event: { matches: boolean }) => void>();

function fakeContext(canvas: HTMLCanvasElement): unknown {
  return {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingQuality: 'low',
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: (x: number, y: number): void => {
      calls.push({ op: 'scale', canvas, x, y });
    },
    clearRect: (): void => {
      calls.push({ op: 'clear', canvas });
    },
    drawImage: (image: { name?: string }): void => {
      const name = image instanceof HTMLCanvasElement ? '<eyes>' : (image.name ?? '?');
      if (name === failDraw) throw new Error(`no se pudo pintar ${name}`);
      calls.push({ op: 'draw', canvas, image: name });
    },
  };
}

/** Ejecuta los fotogramas pendientes como si el reloj marcara `now` milisegundos. */
function step(now: number): void {
  const due = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of due) callback(now);
  });
}

/** Deja correr el tiempo de sobra para que fundidos y mirada se asienten. */
function settle(from: number): number {
  let now = from;
  for (let i = 0; i < 12; i += 1) {
    now += 100;
    step(now);
  }
  return now;
}

/** Lo que se pintó en el lienzo desde la última vez que se borró. */
function lastFrame(canvas: HTMLCanvasElement): string[] {
  const own = calls.filter((call) => call.canvas === canvas);
  const lastClear = own.map((call) => call.op).lastIndexOf('clear');
  return own
    .slice(lastClear + 1)
    .filter((call) => call.op === 'draw')
    .map((call) => call.image ?? '?');
}

const clears = (canvas: HTMLCanvasElement): number =>
  calls.filter((call) => call.canvas === canvas && call.op === 'clear').length;

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
};

// ── modelo de prueba ─────────────────────────────────────────────────────────

const fakeImage = (name: string): LayerImage => ({ name }) as unknown as LayerImage;

/** El modelo sintético ya «cargado», con imágenes que solo llevan su nombre. */
function fakeModel(): LoadedLayers & { release: ReturnType<typeof vi.fn> } {
  const parsed = parseSpriteLayersManifest(
    JSON.parse(readModelFile('avatar.manifest.json').toString('utf8')),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const { manifest } = parsed;
  return {
    manifest,
    images: {
      layers: new Map(['outline', 'base', 'glow'].map((name) => [name, fakeImage(name)])),
      pieces: new Map(Object.keys(manifest.face.pieces).map((name) => [name, fakeImage(name)])),
    },
    release: vi.fn(),
  };
}

type Load = (manifestUrl: string, signal: AbortSignal) => Promise<LoadedLayers>;

/** Una carga que el test resuelve o rechaza cuando quiere. */
function deferredLoad(): {
  load: ReturnType<typeof vi.fn<Load>>;
  signals: AbortSignal[];
  resolve: (model: LoadedLayers) => void;
  reject: (err: unknown) => void;
} {
  const signals: AbortSignal[] = [];
  let resolve: (model: LoadedLayers) => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const load = vi.fn<Load>((_url, signal) => {
    signals.push(signal);
    return new Promise<LoadedLayers>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return {
    load,
    signals,
    resolve: (model) => {
      resolve(model);
    },
    reject: (err) => {
      reject(err);
    },
  };
}

const canvasOf = (container: HTMLElement): HTMLCanvasElement => {
  const canvas = container.querySelector('canvas');
  if (canvas === null) throw new Error('no hay lienzo');
  return canvas;
};

/** Monta el lienzo con el modelo ya cargado y el primer fotograma pintado. */
async function mountLoaded(props: Partial<Parameters<typeof LayersCanvas>[0]> = {}): Promise<{
  canvas: HTMLCanvasElement;
  model: ReturnType<typeof fakeModel>;
  load: ReturnType<typeof vi.fn<Load>>;
  onLoadError: ReturnType<typeof vi.fn>;
  view: ReturnType<typeof render>;
}> {
  const model = fakeModel();
  const load = vi.fn<Load>(() => Promise.resolve(model));
  const onLoadError = vi.fn();
  const view = render(
    <LayersCanvas
      manifestUrl="/modelo/avatar.manifest.json"
      size={200}
      load={load}
      onLoadError={onLoadError}
      {...props}
    />,
  );
  await flush();
  step(0);
  return { canvas: canvasOf(view.container), model, load, onLoadError, view };
}

beforeEach(() => {
  calls = [];
  failDraw = null;
  noContext = false;
  frames = new Map();
  nextFrameId = 1;
  reducedMotion = false;
  motionListeners = new Set();
  lipSync = null;

  const contexts = new WeakMap<HTMLCanvasElement, unknown>();
  function getContext(this: HTMLCanvasElement): unknown {
    if (noContext) return null;
    const known = contexts.get(this) ?? fakeContext(this);
    contexts.set(this, known);
    return known;
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    getContext as unknown as HTMLCanvasElement['getContext'],
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.set(nextFrameId, callback);
    nextFrameId += 1;
    return nextFrameId - 1;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    frames.delete(id);
  });
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: reducedMotion,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void): void => {
      motionListeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void): void => {
      motionListeners.delete(listener);
    },
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── el lienzo ────────────────────────────────────────────────────────────────

describe('LayersCanvas — carga y dibujo', () => {
  it('mientras carga hay un lienzo vacío del tamaño pedido; al cargar, pinta', async () => {
    const pending = deferredLoad();
    const { container } = render(
      <LayersCanvas manifestUrl="/modelo/avatar.manifest.json" size={200} load={pending.load} />,
    );
    const canvas = canvasOf(container);

    expect(canvas.style.width).toBe('200px');
    expect(canvas.style.height).toBe('200px');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.dataset.ready).toBe('false');
    expect(pending.load).toHaveBeenCalledWith('/modelo/avatar.manifest.json', pending.signals[0]);
    expect(frames.size).toBe(0);

    pending.resolve(fakeModel());
    await flush();
    step(0);

    expect(canvas.dataset.ready).toBe('true');
    expect(lastFrame(canvas)).toEqual([
      'base',
      '<eyes>',
      'eyes_open_lines',
      'mouth_idle',
      'brows_idle',
      'glow',
    ]);
  });

  it('el lienzo interno sigue al tamaño pedido sin volver a cargar el modelo', async () => {
    const { canvas, load, view } = await mountLoaded();
    expect([canvas.width, canvas.height]).toEqual([200, 200]);

    view.rerender(
      <LayersCanvas manifestUrl="/modelo/avatar.manifest.json" size={320} load={load} />,
    );
    step(FRAME_MS);

    expect(canvas.style.width).toBe('320px');
    expect([canvas.width, canvas.height]).toEqual([320, 320]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it(`no pinta más de ${String(MAX_FPS)} veces por segundo`, async () => {
    const { canvas } = await mountLoaded();
    expect(clears(canvas)).toBe(1);

    step(FRAME_MS / 2);
    expect(clears(canvas)).toBe(1);

    step(FRAME_MS);
    expect(clears(canvas)).toBe(2);
  });
});

describe('LayersCanvas — emoción y voz', () => {
  it('la emoción elige la expresión, al montar y al cambiar', async () => {
    const { canvas, load, view } = await mountLoaded({ emotion: 'divertida' });
    let now = settle(0);
    expect(lastFrame(canvas)).toContain('brows_smirk');
    expect(lastFrame(canvas)).not.toContain('brows_idle');

    view.rerender(
      <LayersCanvas
        manifestUrl="/modelo/avatar.manifest.json"
        size={200}
        load={load}
        emotion="pensativa"
      />,
    );
    now = settle(now);
    expect(lastFrame(canvas)).toContain('brows_thinking');

    view.rerender(
      <LayersCanvas
        manifestUrl="/modelo/avatar.manifest.json"
        size={200}
        load={load}
        emotion="neutral"
      />,
    );
    settle(now);
    expect(lastFrame(canvas)).toContain('brows_idle');
  });

  it('el nivel de voz abre la boca, y sin voz se cierra', async () => {
    const audio = document.createElement('audio');
    const { canvas } = await mountLoaded({ audioElement: audio });
    expect(lipSync?.audioElement).toBe(audio);

    act(() => {
      lipSync?.setMouthOpen?.(0.7);
    });
    step(FRAME_MS);
    expect(lastFrame(canvas)).toContain('mouth_open_l');

    act(() => {
      lipSync?.setMouthOpen?.(0);
    });
    step(FRAME_MS * 2);
    expect(lastFrame(canvas)).toContain('mouth_idle');
  });

  it('un nivel de voz que llega antes de cargar no rompe nada', () => {
    const pending = deferredLoad();
    render(
      <LayersCanvas manifestUrl="/modelo/avatar.manifest.json" size={200} load={pending.load} />,
    );
    expect(() => {
      lipSync?.setMouthOpen?.(0.5);
    }).not.toThrow();
  });
});

describe('LayersCanvas — reducir el movimiento', () => {
  const stretches = (canvas: HTMLCanvasElement): number[] =>
    calls
      .filter((call) => call.canvas === canvas && call.op === 'scale')
      .map((call) => (call.y ?? NaN) / (call.x ?? NaN));

  it('sin la preferencia, respira; al activarla con la app abierta, deja de hacerlo', async () => {
    const { canvas } = await mountLoaded();
    let now = settle(0);
    expect(stretches(canvas).some((ratio) => ratio !== 1)).toBe(true);

    act(() => {
      for (const listener of motionListeners) listener({ matches: true });
    });
    calls = [];
    now = settle(now);
    expect(stretches(canvas).length).toBeGreaterThan(0);
    expect(stretches(canvas).every((ratio) => ratio === 1)).toBe(true);
  });

  it('con la preferencia ya activa al montar, no respira', async () => {
    reducedMotion = true;
    const { canvas } = await mountLoaded();
    settle(0);
    expect(stretches(canvas).every((ratio) => ratio === 1)).toBe(true);
  });
});

describe('LayersCanvas — fallos y limpieza', () => {
  it('si el modelo no carga, avisa una vez y no arranca el dibujo', async () => {
    const pending = deferredLoad();
    const onLoadError = vi.fn();
    render(
      <LayersCanvas
        manifestUrl="/modelo/avatar.manifest.json"
        size={200}
        load={pending.load}
        onLoadError={onLoadError}
      />,
    );
    const err = new LayersLoadError('image', 'no se pudo cargar la imagen «iris»');

    pending.reject(err);
    await flush();

    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(onLoadError).toHaveBeenCalledWith(err);
    expect(frames.size).toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it('si el navegador no da un contexto 2D, avisa y suelta las imágenes', async () => {
    noContext = true;
    const { model, onLoadError } = await mountLoaded();

    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(model.release).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('si una imagen falla al pintarse, avisa una vez, para y suelta las imágenes', async () => {
    const { canvas, model, onLoadError } = await mountLoaded();
    const before = clears(canvas);

    failDraw = 'glow';
    step(FRAME_MS);
    step(FRAME_MS * 2);

    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(model.release).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(clears(canvas)).toBe(before + 1);
  });

  it('al desmontar para el dibujo, suelta las imágenes y no avisa de ningún fallo', async () => {
    const { canvas, model, onLoadError, view } = await mountLoaded();
    const before = calls.length;

    view.unmount();
    step(FRAME_MS);

    expect(frames.size).toBe(0);
    expect(model.release).toHaveBeenCalledTimes(1);
    expect(onLoadError).not.toHaveBeenCalled();
    expect(calls.length).toBe(before);
    expect(motionListeners.size).toBe(0);
    expect(canvas.isConnected).toBe(false);
  });

  it('si se desmonta a mitad de la carga, la cancela y suelta lo que llegue después', async () => {
    const pending = deferredLoad();
    const onLoadError = vi.fn();
    const view = render(
      <LayersCanvas
        manifestUrl="/modelo/avatar.manifest.json"
        size={200}
        load={pending.load}
        onLoadError={onLoadError}
      />,
    );

    view.unmount();
    expect(pending.signals[0]?.aborted).toBe(true);

    const model = fakeModel();
    pending.resolve(model);
    await flush();

    expect(model.release).toHaveBeenCalledTimes(1);
    expect(onLoadError).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('una carga cancelada que rechaza no cuenta como fallo del modelo', async () => {
    const pending = deferredLoad();
    const onLoadError = vi.fn();
    const view = render(
      <LayersCanvas
        manifestUrl="/modelo/avatar.manifest.json"
        size={200}
        load={pending.load}
        onLoadError={onLoadError}
      />,
    );

    view.unmount();
    pending.reject(new DOMException('carga del modelo cancelada', 'AbortError'));
    await flush();

    expect(onLoadError).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('con otro manifiesto, suelta el modelo anterior y carga el nuevo', async () => {
    const { model, load, view } = await mountLoaded();

    view.rerender(<LayersCanvas manifestUrl="/otro/avatar.manifest.json" size={200} load={load} />);
    await flush();

    expect(model.release).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1]?.[0]).toBe('/otro/avatar.manifest.json');
  });
});

// ── el motor y la lista por defecto ──────────────────────────────────────────

/** Carpeta del modelo de la chibi tal como la pide la app. */
const CHIBI_FOLDER = CHIBI_MANIFEST_URL.slice(0, CHIBI_MANIFEST_URL.lastIndexOf('/') + 1);

function response(body: Buffer | string, status = 200, name = ''): Response {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    headers: { get: () => null },
    text: () => Promise.resolve(bytes.toString('utf8')),
    blob: () => Promise.resolve({ bytes, name }),
  } as unknown as Response;
}

/**
 * Sirve el modelo sintético donde la app busca a la chibi. Todo lo demás
 * (también el modelo Live2D) responde 404. `overrides` cambia una ruta.
 */
function serveChibi(overrides: Record<string, () => Response> = {}): { requests: string[] } {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL): Promise<Response> => {
      const { pathname } = new URL(String(input), 'http://localhost:5173/');
      requests.push(pathname);
      if (!pathname.startsWith(CHIBI_FOLDER)) return Promise.resolve(response('no', 404));
      const inside = pathname.slice(CHIBI_FOLDER.length);
      const override = overrides[inside];
      if (override !== undefined) return Promise.resolve(override());
      try {
        const name = inside.slice(inside.lastIndexOf('/') + 1).replace('.png', '');
        return Promise.resolve(response(readModelFile(inside), 200, name));
      } catch {
        return Promise.resolve(response('no', 404));
      }
    }),
  );
  vi.stubGlobal('createImageBitmap', (blob: { bytes: Buffer; name: string }) =>
    blob.bytes.subarray(1, 4).toString('latin1') === 'PNG'
      ? Promise.resolve({
          name: blob.name,
          width: blob.bytes.readUInt32BE(16),
          height: blob.bytes.readUInt32BE(20),
          close: vi.fn(),
        })
      : Promise.reject(new Error('no es una imagen')),
  );
  return { requests };
}

describe('layersEngine', () => {
  const candidate = layersCandidate(CHIBI_MANIFEST_URL);
  const signal = (): AbortSignal => new AbortController().signal;

  it('el candidato lleva el tipo del manifiesto y su URL', () => {
    expect(candidate).toEqual({ kind: 'sprite-layers', manifestUrl: CHIBI_MANIFEST_URL });
    expect(layersEngine.kind).toBe(LAYERS_KIND);
  });

  it('con el modelo instalado, la comprobación dice que sí y solo pide el manifiesto', async () => {
    const { requests } = serveChibi();
    expect(await layersEngine.probe(candidate, signal())).toBe(true);
    expect(requests).toEqual([CHIBI_MANIFEST_URL]);
  });

  it.each([
    ['no hay chibi instalada', (): Response => response('no', 404)],
    ['en esa URL hay otra cosa', (): Response => response('<!doctype html><title>app</title>')],
  ])('si %s, dice que no y no ensucia la consola', async (_name, respond) => {
    serveChibi({ 'avatar.manifest.json': respond });
    expect(await layersEngine.probe(candidate, signal())).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('si el manifiesto está pero no vale, dice que no y explica por qué', async () => {
    serveChibi({ 'avatar.manifest.json': () => response('{"kind":"sprite-layers"}') });
    expect(await layersEngine.probe(candidate, signal())).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain(CHIBI_MANIFEST_URL);
  });

  it('un candidato que no es suyo no se pide', async () => {
    const { requests } = serveChibi();
    expect(await layersEngine.probe({ kind: 'live2d' }, signal())).toBe(false);
    expect(await layersEngine.probe({ kind: LAYERS_KIND }, signal())).toBe(false);
    expect(requests).toEqual([]);
  });

  it('entrega siempre el mismo componente', async () => {
    expect(await layersEngine.load()).toBe(await layersEngine.load());
  });
});

describe('<Avatar> con la lista por defecto', () => {
  const wrapOf = (container: HTMLElement): HTMLElement => {
    const wrap = container.querySelector<HTMLElement>('[data-render]');
    if (wrap === null) throw new Error('no hay avatar');
    return wrap;
  };

  it('con la chibi instalada y sin Live2D, sale la chibi', async () => {
    const { requests } = serveChibi();
    const { container } = render(<Avatar />);
    expect(wrapOf(container).dataset.render).toBe('orb');

    await waitFor(() => {
      expect(wrapOf(container).dataset.render).toBe('sprite-layers');
    });
    await waitFor(() => {
      expect(frames.size).toBeGreaterThan(0);
    });
    step(0);

    const canvas = canvasOf(container);
    expect(canvas.dataset.ready).toBe('true');
    expect(lastFrame(canvas)).toContain('base');
    // Live2D se comprueba primero: es el orden del ADR 0028 §3.
    expect(requests[0]).toBe(AVATAR_CONFIG.modelPath);
  });

  it('sin ningún modelo instalado, se queda en el orbe', async () => {
    const { requests } = serveChibi({ 'avatar.manifest.json': () => response('no', 404) });
    const { container } = render(<Avatar />);

    await waitFor(() => {
      expect(requests).toContain(CHIBI_MANIFEST_URL);
    });
    await flush();

    expect(wrapOf(container).dataset.render).toBe('orb');
  });

  it('si a la chibi le falta una imagen, el modelo entero no vale: orbe', async () => {
    serveChibi({ 'assets/iris.png': () => response('no', 404) });
    const { container } = render(<Avatar />);

    await waitFor(() => {
      expect(wrapOf(container).dataset.render).toBe('sprite-layers');
    });
    await waitFor(() => {
      expect(wrapOf(container).dataset.render).toBe('orb');
    });
    expect(container.querySelector('canvas')).toBeNull();
  });
});
