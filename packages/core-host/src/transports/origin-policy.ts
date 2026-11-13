/**
 * Política de `Origin` del core-host (ADR 0027, secuencia 2a).
 *
 * Un navegador manda siempre `Origin` al abrir un WebSocket o al pedir un
 * recurso con CORS, y una página no puede falsearlo. Comprobarlo cierra el
 * «drive-by»: una web cualquiera abierta en el navegador que intenta hablar
 * con `ws://localhost:9876/bus`.
 *
 * Los clientes que no son navegador (Node, scripts) no mandan `Origin`.
 * Mientras no haya token (2b), su ausencia se acepta porque el servidor solo
 * escucha en loopback. Sin variable de entorno: los orígenes configurables
 * llegarán con el protocolo multicliente.
 *
 * Quedan fuera a propósito otros orígenes de desarrollo, como `vite preview`
 * (puerto 4173) o Vite abierto por `http://[::1]:5173`: recibirían un 403 y
 * el cliente se quedaría reconectando.
 */

/** Orígenes de los clientes propios. Comparación exacta, sin comodines. */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  // Webview de Tauri 2 en Windows (sin `useHttpsScheme`): el binario empaquetado.
  'http://tauri.localhost',
  // Vite en desarrollo (`strictPort` en 5173), también bajo `tauri dev`.
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/** Largo máximo de un `Origin` rechazado en el log: lo controla quien llama. */
const MAX_LOGGED_ORIGIN_LENGTH = 200;

/**
 * ¿Se acepta una petición con esta cabecera `Origin`? `undefined` es «no la
 * mandó». Una cabecera presente y no reconocida se rechaza siempre.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return DEFAULT_ALLOWED_ORIGINS.includes(origin);
}

/** Texto de un `Origin` rechazado, recortado, para escribirlo en el log. */
export function describeRejectedOrigin(origin: string | undefined): string {
  return `Origin rechazado: ${String(origin).slice(0, MAX_LOGGED_ORIGIN_LENGTH)}`;
}
