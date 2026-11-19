/**
 * Cargador del motor de capas (ADR 0028 §3 y §4): baja el manifiesto, lo
 * valida y trae todas las imágenes del modelo, o ninguna.
 *
 * El modelo es el sintético de `docs/design/chibi-prototype/test-model/`,
 * servido desde disco por un `fetch` falso. Las imágenes se «descodifican»
 * leyendo el ancho y el alto de la cabecera de cada PNG: son los tamaños
 * reales de los archivos, no números puestos a mano.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LayersLoadError,
  MAX_MANIFEST_BYTES,
  fetchManifest,
  loadBitmap,
  loadLayers,
  resolveAssetUrl,
  type ImageLoader,
  type LoadedImage,
} from '../../src/components/Avatar/engines/layers/loader';
import type { LayerImage } from '../../src/components/Avatar/engines/layers/player';

const TEST_MODEL = path.resolve(__dirname, '../../../../docs/design/chibi-prototype/test-model');
const FOLDER = '/avatar/models/prueba/';
const MANIFEST_URL = `${FOLDER}avatar.manifest.json`;
const BASE = 'http://localhost:5173/';

const readModelFile = (name: string): Buffer => readFileSync(path.join(TEST_MODEL, name));
const readManifest = (name = 'avatar.manifest.json'): Record<string, unknown> =>
  JSON.parse(readModelFile(name).toString('utf8')) as Record<string, unknown>;

// ── dobles de la red y del descodificador ────────────────────────────────────

interface ResponseInit {
  status?: number;
  contentLength?: string;
  redirected?: boolean;
}

/** Una respuesta con lo justo: el cuerpo viaja en `bytes` hasta el descodificador falso. */
function fakeResponse(body: Buffer | string, init: ResponseInit = {}): Response {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: init.redirected ?? false,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length' ? (init.contentLength ?? null) : null,
    },
    text: () => Promise.resolve(bytes.toString('utf8')),
    blob: () => Promise.resolve({ bytes }),
  } as unknown as Response;
}

const notFound = (): Response => fakeResponse('no está', { status: 404 });

interface Served {
  /** Ruta, relativa a la carpeta del modelo, de cada petición. */
  paths: string[];
  signals: (AbortSignal | undefined)[];
}

/**
 * Sirve la carpeta del modelo sintético como si colgara de `FOLDER`.
 * `overrides` sustituye la respuesta de una ruta concreta.
 */
function serveModel(overrides: Record<string, () => Response> = {}): Served {
  const served: Served = { paths: [], signals: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL, init?: RequestInit): Promise<Response> => {
      const { pathname } = new URL(String(input), BASE);
      const inside = pathname.startsWith(FOLDER) ? pathname.slice(FOLDER.length) : null;
      served.paths.push(inside ?? pathname);
      served.signals.push(init?.signal ?? undefined);
      if (inside === null) return Promise.resolve(notFound());
      const override = overrides[inside];
      if (override !== undefined) return Promise.resolve(override());
      try {
        return Promise.resolve(fakeResponse(readModelFile(inside)));
      } catch {
        return Promise.resolve(notFound());
      }
    }),
  );
  return served;
}

interface FakeBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

let bitmaps: FakeBitmap[] = [];

/** Lee el ancho y el alto de la cabecera IHDR de un PNG. */
function decodePng(blob: { bytes: Buffer }): Promise<FakeBitmap> {
  const { bytes } = blob;
  if (bytes.subarray(1, 4).toString('latin1') !== 'PNG') {
    return Promise.reject(new Error('no es una imagen'));
  }
  const bitmap = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), close: vi.fn() };
  bitmaps.push(bitmap);
  return Promise.resolve(bitmap);
}

const signal = (): AbortSignal => new AbortController().signal;

/** Espera el rechazo y devuelve el error, para mirar su motivo. */
async function failure(promise: Promise<unknown>): Promise<LayersLoadError> {
  const outcome = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(outcome instanceof LayersLoadError)) {
    throw new Error(`se esperaba un LayersLoadError y llegó: ${String(outcome)}`);
  }
  return outcome;
}

beforeEach(() => {
  bitmaps = [];
  vi.stubGlobal('createImageBitmap', vi.fn(decodePng));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── manifiesto ───────────────────────────────────────────────────────────────

describe('fetchManifest', () => {
  it('baja y valida el manifiesto del modelo sintético', async () => {
    const served = serveModel();
    const controller = new AbortController();

    const manifest = await fetchManifest(MANIFEST_URL, controller.signal);

    expect(manifest.kind).toBe('sprite-layers');
    expect(manifest.size).toEqual([120, 200]);
    expect(served.paths).toEqual(['avatar.manifest.json']);
    expect(served.signals[0]).toBe(controller.signal);
  });

  it.each([
    ['no existe', (): Response => notFound(), 'not-found'],
    [
      'llega tras una redirección',
      (): Response => fakeResponse('{}', { redirected: true }),
      'not-found',
    ],
    ['no es JSON', (): Response => fakeResponse('<!doctype html><title>app</title>'), 'not-json'],
    ['no cumple el esquema', (): Response => fakeResponse('{"kind":"sprite-layers"}'), 'invalid'],
    [
      'es de otro motor',
      (): Response => fakeResponse(JSON.stringify({ ...readManifest(), kind: 'live2d' })),
      'invalid',
    ],
    [
      'declara un tamaño enorme',
      (): Response => fakeResponse('{}', { contentLength: String(MAX_MANIFEST_BYTES + 1) }),
      'too-big',
    ],
    [
      'es enorme sin declararlo',
      (): Response => fakeResponse(`{"relleno":"${'x'.repeat(MAX_MANIFEST_BYTES)}"}`),
      'too-big',
    ],
  ])('si el manifiesto %s, falla con su motivo', async (_name, respond, reason) => {
    serveModel({ 'avatar.manifest.json': respond });
    const err = await failure(fetchManifest(MANIFEST_URL, signal()));
    expect(err.reason).toBe(reason);
  });

  it('un manifiesto inválido dice dónde está el primer problema', async () => {
    const broken = { ...readManifest(), size: [0, 200] };
    serveModel({ 'avatar.manifest.json': () => fakeResponse(JSON.stringify(broken)) });
    const err = await failure(fetchManifest(MANIFEST_URL, signal()));
    expect(err.message).toContain('size');
  });

  it('si la red falla, falla como «no está»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const err = await failure(fetchManifest(MANIFEST_URL, signal()));
    expect(err.reason).toBe('not-found');
  });

  it('una carga cancelada sale como cancelación, no como fallo del modelo', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        controller.abort();
        return Promise.reject(new DOMException('cancelada', 'AbortError'));
      }),
    );
    await expect(fetchManifest(MANIFEST_URL, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

// ── rutas ────────────────────────────────────────────────────────────────────

describe('resolveAssetUrl', () => {
  it.each([
    [BASE, 'http://localhost:5173/avatar/models/prueba/assets/base.png'],
    ['tauri://localhost/', 'tauri://localhost/avatar/models/prueba/assets/base.png'],
    [
      'http://tauri.localhost/index.html',
      'http://tauri.localhost/avatar/models/prueba/assets/base.png',
    ],
  ])('con la app en %s, la imagen cuelga de la carpeta del manifiesto', (base, expected) => {
    expect(resolveAssetUrl(MANIFEST_URL, 'assets/base.png', base)).toBe(expected);
  });

  it('la carpeta es la del manifiesto aunque su URL lleve consulta', () => {
    expect(resolveAssetUrl(`${MANIFEST_URL}?v=2`, 'base.png', BASE)).toBe(
      'http://localhost:5173/avatar/models/prueba/base.png',
    );
  });

  // El esquema ya rechaza estas rutas; el cargador no se fía y lo vuelve a mirar
  // sobre la URL resuelta, que es la que se va a pedir.
  it.each([
    '../otro/base.png',
    'assets/../../base.png',
    '/base.png',
    '//otro.invalid/base.png',
    'http://otro.invalid/base.png',
    'https://localhost:5173/avatar/models/prueba/base.png',
    '\\\\otro.invalid\\base.png',
    'base.png?x=1',
    'base.png#x',
    '',
  ])('«%s» no se pide: sale de la carpeta del modelo o no es un archivo de ella', (route) => {
    expect(() => resolveAssetUrl(MANIFEST_URL, route, BASE)).toThrow(LayersLoadError);
  });

  it('una carpeta vecina que empieza igual no cuenta como la del modelo', () => {
    // «/avatar/models/prueba-otra/» empieza como «/avatar/models/prueba», pero es otra carpeta.
    expect(() => resolveAssetUrl(MANIFEST_URL, '../prueba-otra/base.png', BASE)).toThrow(
      LayersLoadError,
    );
  });
});

// ── modelo entero ────────────────────────────────────────────────────────────

describe('loadLayers', () => {
  it('trae todas las imágenes del modelo, cada una en su mapa', async () => {
    const served = serveModel();
    const raw = readManifest() as { face: { pieces: Record<string, string> } };
    const pieceNames = Object.keys(raw.face.pieces);

    const loaded = await loadLayers(MANIFEST_URL, signal());

    expect([...loaded.images.layers.keys()].sort()).toEqual(['base', 'glow', 'outline']);
    expect([...loaded.images.pieces.keys()].sort()).toEqual([...pieceNames].sort());
    expect(loaded.manifest.face.rect).toEqual([20, 30, 80, 60]);
    // Una petición por el manifiesto y una por imagen, todas dentro de la carpeta.
    expect(served.paths).toHaveLength(1 + 3 + pieceNames.length);
    expect(served.paths.every((p) => p === 'avatar.manifest.json' || p.startsWith('assets/'))).toBe(
      true,
    );
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 0)).toBe(true);
  });

  it('con el manifiesto mínimo solo pide lo que declara', async () => {
    const served = serveModel({
      'avatar.manifest.json': () => fakeResponse(readModelFile('avatar.minimal.manifest.json')),
    });
    const raw = readManifest('avatar.minimal.manifest.json') as {
      layers: Record<string, string>;
      face: { pieces: Record<string, string> };
    };

    const loaded = await loadLayers(MANIFEST_URL, signal());

    expect([...loaded.images.layers.keys()]).toEqual(Object.keys(raw.layers));
    expect(served.paths).toHaveLength(
      1 + Object.keys(raw.layers).length + Object.keys(raw.face.pieces).length,
    );
  });

  it('una capa que este motor no conoce ni se pide', async () => {
    const raw = readManifest() as { layers: Record<string, string> };
    raw.layers.hair_back = 'assets/no-existe.png';
    const served = serveModel({
      'avatar.manifest.json': () => fakeResponse(JSON.stringify(raw)),
    });

    const loaded = await loadLayers(MANIFEST_URL, signal());

    expect(served.paths).not.toContain('assets/no-existe.png');
    expect(loaded.images.layers.has('hair_back')).toBe(false);
  });

  it('release cierra cada imagen una sola vez, aunque se llame dos', async () => {
    serveModel();
    const loaded = await loadLayers(MANIFEST_URL, signal());
    expect(bitmaps.length).toBeGreaterThan(20);

    loaded.release();
    loaded.release();

    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
  });

  it.each([
    ['falta', (): Response => notFound()],
    ['no es una imagen', (): Response => fakeResponse('<!doctype html>')],
  ])('si una imagen %s, el modelo entero no vale y no queda nada abierto', async (_n, respond) => {
    serveModel({ 'assets/mouth_open_m.png': respond });

    const err = await failure(loadLayers(MANIFEST_URL, signal()));

    expect(err.reason).toBe('image');
    expect(err.message).toContain('mouth_open_m');
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
  });

  it.each([
    ['una capa', 'assets/glow.png', 'assets/iris.png', 'glow', '80×60', '120×200'],
    ['una pieza de la cara', 'assets/iris.png', 'assets/base.png', 'iris', '120×200', '80×60'],
  ])(
    'si %s no mide lo que dice el manifiesto, el modelo no vale',
    async (_name, route, swappedFor, name, got, want) => {
      serveModel({ [route]: () => fakeResponse(readModelFile(swappedFor)) });

      const err = await failure(loadLayers(MANIFEST_URL, signal()));

      expect(err.reason).toBe('size');
      expect(err.message).toContain(`«${name}»`);
      expect(err.message).toContain(got);
      expect(err.message).toContain(want);
      expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
    },
  );

  it('si el modelo declara más píxeles de los que caben, no pide ninguna imagen', async () => {
    const raw = readManifest() as { size: number[]; face: { rect: number[] } };
    raw.size = [8192, 8192];
    raw.face.rect = [0, 0, 8192, 8192];
    const served = serveModel({ 'avatar.manifest.json': () => fakeResponse(JSON.stringify(raw)) });

    const err = await failure(loadLayers(MANIFEST_URL, signal()));

    expect(err.reason).toBe('too-big');
    expect(served.paths).toEqual(['avatar.manifest.json']);
  });
});

describe('loadLayers — cancelación y carreras', () => {
  /** Cargador de imágenes a mano: cada petición se resuelve cuando el test quiere. */
  function manualLoader(): {
    loadImage: ImageLoader;
    pending: Map<
      string,
      { resolve: (size?: [number, number]) => void; reject: (err: unknown) => void }
    >;
    released: string[];
    signals: AbortSignal[];
  } {
    const pending = new Map<
      string,
      { resolve: (size?: [number, number]) => void; reject: (err: unknown) => void }
    >();
    const released: string[] = [];
    const signals: AbortSignal[] = [];
    const loadImage: ImageLoader = (url, loadSignal) =>
      new Promise<LoadedImage>((resolve, reject) => {
        const name = url.slice(url.lastIndexOf('/') + 1).replace('.png', '');
        const isLayer = ['base', 'glow', 'outline'].includes(name);
        signals.push(loadSignal);
        pending.set(name, {
          resolve: ([width, height] = isLayer ? [120, 200] : [80, 60]) => {
            resolve({
              image: { name } as unknown as LayerImage,
              width,
              height,
              release: () => released.push(name),
            });
          },
          reject,
        });
      });
    return { loadImage, pending, released, signals };
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('si una imagen falla, corta las que siguen en curso y suelta las que ya llegaron', async () => {
    serveModel();
    const loader = manualLoader();
    const result = failure(loadLayers(MANIFEST_URL, signal(), { loadImage: loader.loadImage }));
    await settle();

    loader.pending.get('base')?.resolve();
    await settle();
    loader.pending.get('glow')?.reject(new Error('roto'));
    const err = await result;

    expect(err.reason).toBe('image');
    expect(loader.released).toEqual(['base']);
    expect(loader.signals.every((s) => s.aborted)).toBe(true);
  });

  it('una imagen que llega después del fallo también se suelta', async () => {
    serveModel();
    const loader = manualLoader();
    const result = failure(loadLayers(MANIFEST_URL, signal(), { loadImage: loader.loadImage }));
    await settle();

    loader.pending.get('glow')?.reject(new Error('roto'));
    await result;
    loader.pending.get('iris')?.resolve(); // un cargador que no hizo caso a la señal
    await settle();

    expect(loader.released).toEqual(['iris']);
  });

  it('al cancelar a mitad, sale como cancelación y no deja ninguna imagen abierta', async () => {
    serveModel();
    const loader = manualLoader();
    const controller = new AbortController();
    const result = loadLayers(MANIFEST_URL, controller.signal, { loadImage: loader.loadImage });
    await settle();

    loader.pending.get('base')?.resolve();
    await settle();
    controller.abort();
    for (const entry of loader.pending.values()) entry.resolve();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await settle();
    expect(loader.released).toHaveLength(loader.pending.size);
  });

  it('con la señal ya cancelada no pide nada', async () => {
    const served = serveModel();
    const controller = new AbortController();
    controller.abort();

    await expect(loadLayers(MANIFEST_URL, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(served.paths).toEqual([]);
  });
});

// ── una imagen ───────────────────────────────────────────────────────────────

describe('loadBitmap', () => {
  const url = `${BASE.slice(0, -1)}${FOLDER}assets/base.png`;

  it('baja la imagen y dice cuánto mide', async () => {
    const served = serveModel();
    const controller = new AbortController();

    const loaded = await loadBitmap(url, controller.signal);

    expect([loaded.width, loaded.height]).toEqual([120, 200]);
    expect(served.signals[0]).toBe(controller.signal);
    loaded.release();
    expect(bitmaps[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('una respuesta que no es 2xx no se intenta descodificar', async () => {
    serveModel({ 'assets/base.png': notFound });
    await expect(loadBitmap(url, signal())).rejects.toThrow(/404/);
    expect(bitmaps).toEqual([]);
  });

  it('si se cancela mientras descodifica, cierra la imagen y no la entrega', async () => {
    serveModel();
    const controller = new AbortController();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn((blob: { bytes: Buffer }) => {
        controller.abort();
        return decodePng(blob);
      }),
    );

    await expect(loadBitmap(url, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmaps[0]?.close).toHaveBeenCalledTimes(1);
  });
});
