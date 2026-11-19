/**
 * Cargador del motor de capas (ADR 0028 §3 y §4): baja el manifiesto de un
 * modelo, lo valida y trae todas sus imágenes.
 *
 * Es la frontera con archivos que no escribe la app. Por eso:
 *
 * - **Todo o nada.** Si falta una sola imagen, o no mide lo que dice el
 *   manifiesto, el modelo entero no vale: una figura con la boca en otro
 *   sitio es peor que el orbe.
 * - **Nada sale de la carpeta del modelo.** El esquema ya rechaza las rutas
 *   que lo intentan; aquí se vuelve a mirar sobre la URL resuelta, que es la
 *   que de verdad se va a pedir.
 * - **Se puede cancelar**, y nunca deja imágenes abiertas: ni al fallar, ni
 *   al cancelar, ni cuando una imagen llega tarde.
 *
 * No sabe de React ni dibuja nada: entrega lo que el reproductor necesita.
 */

import { parseSpriteLayersManifest, type SpriteLayersManifest } from './manifest';
import type { LayerImage, LayerImages } from './player';

/** Tope de tamaño del manifiesto. El de la chibi ronda los 4 KB. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * Tope de memoria de las imágenes ya descodificadas (4 bytes por píxel),
 * según los tamaños que declara el manifiesto. La chibi ronda los 49 MB.
 */
export const MAX_DECODED_BYTES = 512 * 1024 * 1024;

/** Capas de figura completa que este motor sabe pintar. El resto de `layers` se ignora. */
const KNOWN_LAYERS = ['outline', 'base', 'glow'] as const;

/**
 * Por qué no se pudo cargar el modelo:
 *
 * - `not-found`: el manifiesto no está (no responde, no es 2xx o redirige).
 * - `not-json`: hay algo en esa URL, pero no es JSON.
 * - `invalid`: es JSON y no cumple el esquema.
 * - `too-big`: el manifiesto o las imágenes que declara pasan de los topes.
 * - `unsafe-path`: una ruta apunta fuera de la carpeta del modelo.
 * - `image`: una imagen falta o no se puede descodificar.
 * - `size`: una imagen no mide lo que dice el manifiesto.
 */
export type LayersLoadFailure =
  'not-found' | 'not-json' | 'invalid' | 'too-big' | 'unsafe-path' | 'image' | 'size';

export class LayersLoadError extends Error {
  readonly reason: LayersLoadFailure;

  constructor(reason: LayersLoadFailure, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LayersLoadError';
    this.reason = reason;
  }
}

/** Una imagen ya descodificada, con su tamaño y la forma de soltarla. */
export interface LoadedImage {
  image: LayerImage;
  width: number;
  height: number;
  release(): void;
}

/** Trae y descodifica una imagen. Debe respetar `signal`. */
export type ImageLoader = (url: string, signal: AbortSignal) => Promise<LoadedImage>;

export interface LoadedLayers {
  manifest: SpriteLayersManifest;
  images: LayerImages;
  /** Suelta todas las imágenes. Llamarlo dos veces no hace nada la segunda. */
  release(): void;
}

export interface LoadLayersOptions {
  /** Cómo se trae cada imagen. Por defecto, `loadBitmap`. */
  loadImage?: ImageLoader;
  /** Contra qué se resuelven las URL relativas. Por defecto, la del documento. */
  baseUrl?: string;
}

const aborted = (): DOMException => new DOMException('carga del modelo cancelada', 'AbortError');

const isAbort = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

/**
 * Baja el manifiesto y lo valida.
 *
 * @throws `LayersLoadError` con el motivo, o un `AbortError` si se cancela.
 */
export async function fetchManifest(
  manifestUrl: string,
  signal: AbortSignal,
): Promise<SpriteLayersManifest> {
  if (signal.aborted) throw aborted();

  let text: string;
  try {
    const response = await fetch(manifestUrl, { signal });
    // Una redirección podría llevar la carpeta del modelo a otro sitio: los
    // modelos son archivos locales y no redirigen.
    if (!response.ok || response.redirected) {
      throw new LayersLoadError(
        'not-found',
        `el manifiesto no está en ${manifestUrl} (HTTP ${String(response.status)})`,
      );
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_MANIFEST_BYTES) throw tooBigManifest();
    text = await response.text();
  } catch (err) {
    if (signal.aborted || isAbort(err)) throw aborted();
    if (err instanceof LayersLoadError) throw err;
    throw new LayersLoadError('not-found', `no se pudo pedir el manifiesto ${manifestUrl}`, err);
  }
  if (text.length > MAX_MANIFEST_BYTES) throw tooBigManifest();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new LayersLoadError('not-json', `${manifestUrl} no es un JSON`, err);
  }

  const result = parseSpriteLayersManifest(raw);
  if (!result.ok) {
    const shown = result.issues
      .slice(0, 3)
      .map((issue) => `${issue.path === '' ? '(raíz)' : issue.path}: ${issue.message}`)
      .join('; ');
    const more = result.issues.length > 3 ? ` (y ${String(result.issues.length - 3)} más)` : '';
    throw new LayersLoadError('invalid', `el manifiesto no es válido — ${shown}${more}`);
  }
  return result.manifest;
}

function tooBigManifest(): LayersLoadError {
  return new LayersLoadError(
    'too-big',
    `el manifiesto pasa de ${String(MAX_MANIFEST_BYTES / 1024)} KB`,
  );
}

/**
 * Convierte una ruta del manifiesto en la URL que se va a pedir, y comprueba
 * que sigue dentro de la carpeta del manifiesto: mismo servidor, misma
 * carpeta o una de dentro, sin consulta ni fragmento.
 *
 * @throws `LayersLoadError` (`unsafe-path`) si no es así.
 */
export function resolveAssetUrl(
  manifestUrl: string,
  route: string,
  baseUrl: string = document.baseURI,
): string {
  const unsafe = (): LayersLoadError =>
    new LayersLoadError('unsafe-path', `la ruta «${route}» no está en la carpeta del modelo`);

  let folder: URL;
  let resolved: URL;
  try {
    folder = new URL('.', new URL(manifestUrl, baseUrl));
    resolved = new URL(route, folder);
  } catch {
    throw unsafe();
  }
  const sameServer =
    resolved.protocol === folder.protocol &&
    resolved.host === folder.host &&
    resolved.username === '' &&
    resolved.password === '';
  // `folder.pathname` acaba en «/»: una carpeta vecina que empiece igual no pasa.
  const inside =
    resolved.pathname.startsWith(folder.pathname) && resolved.pathname !== folder.pathname;
  if (!sameServer || !inside || resolved.search !== '' || resolved.hash !== '') throw unsafe();
  return resolved.href;
}

/**
 * Trae una imagen con `fetch` y la descodifica con `createImageBitmap`. Así
 * la petición se puede cancelar y la memoria se suelta cuando se pide, no
 * cuando pase el recolector de basura.
 */
export const loadBitmap: ImageLoader = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const bitmap = await createImageBitmap(await response.blob());
  if (signal.aborted) {
    bitmap.close();
    throw aborted();
  }
  return {
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => {
      bitmap.close();
    },
  };
};

interface ImageJob {
  group: keyof LayerImages;
  name: string;
  route: string;
  url: string;
  width: number;
  height: number;
}

/** Qué imágenes hay que traer, con la URL y el tamaño que debe tener cada una. */
function planImages(
  manifest: SpriteLayersManifest,
  manifestUrl: string,
  baseUrl: string | undefined,
): ImageJob[] {
  const [width, height] = manifest.size;
  const [, , faceWidth, faceHeight] = manifest.face.rect;
  const job = (group: keyof LayerImages, name: string, route: string): ImageJob => ({
    group,
    name,
    route,
    url: resolveAssetUrl(manifestUrl, route, baseUrl),
    ...(group === 'layers' ? { width, height } : { width: faceWidth, height: faceHeight }),
  });

  const jobs: ImageJob[] = [];
  for (const name of KNOWN_LAYERS) {
    const route = manifest.layers[name];
    if (route !== undefined) jobs.push(job('layers', name, route));
  }
  for (const [name, route] of Object.entries(manifest.face.pieces)) {
    jobs.push(job('pieces', name, route));
  }

  const decodedBytes = jobs.reduce((sum, { width: w, height: h }) => sum + w * h * 4, 0);
  if (decodedBytes > MAX_DECODED_BYTES) {
    throw new LayersLoadError(
      'too-big',
      `el modelo declara ${String(Math.round(decodedBytes / 1024 / 1024))} MB de imágenes; ` +
        `el tope es ${String(MAX_DECODED_BYTES / 1024 / 1024)} MB`,
    );
  }
  return jobs;
}

/**
 * Carga un modelo entero: manifiesto e imágenes.
 *
 * @throws `LayersLoadError` con el motivo, o un `AbortError` si se cancela.
 * En los dos casos no queda ninguna imagen abierta.
 */
export async function loadLayers(
  manifestUrl: string,
  signal: AbortSignal,
  options: LoadLayersOptions = {},
): Promise<LoadedLayers> {
  const { loadImage = loadBitmap, baseUrl } = options;
  const manifest = await fetchManifest(manifestUrl, signal);
  const jobs = planImages(manifest, manifestUrl, baseUrl);

  // Señal propia: se corta al cancelar desde fuera y también al primer fallo,
  // para no seguir bajando un modelo que ya no vale.
  const inner = new AbortController();
  const loaded: LoadedImage[] = [];
  /** A partir de aquí lo que llegue ya no tiene dueño: se suelta al llegar. */
  let closed = false;
  const closeAll = (): void => {
    closed = true;
    inner.abort();
    for (const item of loaded.splice(0)) item.release();
  };

  // Cancelar desde fuera rechaza al momento, sin esperar a las imágenes en curso.
  let rejectCancelled: (reason: DOMException) => void = () => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  // Si nadie llega a esperarla, que su rechazo no cuente como error sin atender.
  cancelled.catch(() => undefined);
  const onAbort = (): void => {
    rejectCancelled(aborted());
  };
  signal.addEventListener('abort', onAbort);

  const loadOne = async (job: ImageJob): Promise<readonly [ImageJob, LayerImage]> => {
    let item: LoadedImage;
    try {
      item = await loadImage(job.url, inner.signal);
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new LayersLoadError(
        'image',
        `no se pudo cargar la imagen «${job.name}» (${job.route})`,
        err,
      );
    }
    if (closed) {
      item.release();
      throw aborted();
    }
    loaded.push(item);
    if (item.width !== job.width || item.height !== job.height) {
      throw new LayersLoadError(
        'size',
        `la imagen «${job.name}» (${job.route}) mide ${String(item.width)}×${String(item.height)} ` +
          `y el manifiesto dice ${String(job.width)}×${String(job.height)}`,
      );
    }
    return [job, item.image];
  };

  try {
    if (signal.aborted) throw aborted();
    const results = await Promise.race([Promise.all(jobs.map(loadOne)), cancelled]);
    const images = { layers: new Map<string, LayerImage>(), pieces: new Map<string, LayerImage>() };
    for (const [job, image] of results) images[job.group].set(job.name, image);
    return { manifest, images, release: closeAll };
  } catch (err) {
    closeAll();
    throw signal.aborted ? aborted() : err;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
