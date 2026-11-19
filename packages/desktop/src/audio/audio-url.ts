/**
 * De la ruta que llega en `tts:audio` a la URL que se reproduce (P-14, R-314).
 *
 * El core-host emite solo la ruta del audio (`/audio/<id>.<ext>`). No puede
 * saber con qué dirección llega cada cliente hasta él: quien lo sabe es el
 * cliente, que ya está conectado a su bus. Así que el audio se pide al mismo
 * servidor de esa conexión, cambiando `ws` por `http`.
 *
 * Lo que llega por el bus no se reproduce a ciegas: si no es un audio de ese
 * mismo servidor, no suena. Ver la enmienda del 2026-11-19 en el ADR 0020.
 */

/** Dónde escucha el bus del core-host si no se configura `VITE_SHIRO_HOST_URL`. */
export const DEFAULT_HOST_URL = 'ws://localhost:9876/bus';

/**
 * La forma de la ruta que sirve el core-host: `/audio/<id>.<ext>`, un solo
 * tramo. La extensión no se limita aquí a una lista: esa la decide el
 * servidor, que contesta 404 a la que no conoce.
 */
const AUDIO_PATH_RE = /^\/audio\/[\w-]+\.[a-z0-9]+$/;

/** Protocolo HTTP que corresponde al de la URL del bus. */
const HTTP_PROTOCOL: Record<string, string> = {
  'ws:': 'http:',
  'wss:': 'https:',
  'http:': 'http:',
  'https:': 'https:',
};

/** Origen HTTP del core-host al que apunta la URL del bus; `null` si no se entiende. */
export function hostHttpOrigin(hostUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(hostUrl);
  } catch {
    return null;
  }
  if (!Object.hasOwn(HTTP_PROTOCOL, parsed.protocol)) return null;
  const protocol = HTTP_PROTOCOL[parsed.protocol];
  if (protocol === undefined || parsed.host === '') return null;
  return `${protocol}//${parsed.host}`;
}

/**
 * URL completa del audio, o `null` si no es un audio del core-host al que
 * este cliente está conectado. Acepta la ruta (`/audio/a.mp3`) y, por
 * compatibilidad, una URL completa de ese mismo servidor.
 */
export function resolveAudioUrl(url: string, hostUrl: string = DEFAULT_HOST_URL): string | null {
  if (url === '') return null;
  const origin = hostHttpOrigin(hostUrl);
  if (origin === null) return null;
  let resolved: URL;
  try {
    resolved = new URL(url, `${origin}/`);
  } catch {
    return null;
  }
  // `origin` solo no basta: el de un `blob:http://…` es el de la URL que lleva dentro.
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
  if (resolved.origin !== origin) return null;
  // Credenciales en la URL: el origen es el mismo, pero no es lo que emite el
  // core-host, y los navegadores no las tratan igual al pedir el audio.
  if (resolved.username !== '' || resolved.password !== '') return null;
  if (resolved.search !== '' || resolved.hash !== '') return null;
  if (!AUDIO_PATH_RE.test(resolved.pathname)) return null;
  return resolved.href;
}
