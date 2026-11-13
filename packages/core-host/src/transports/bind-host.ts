/**
 * Host en el que escucha el core-host (bus WebSocket y `/audio`).
 *
 * Por defecto solo loopback: mientras el bus no tenga token (ADR 0027,
 * secuencia 2b), cualquiera que llegue por la red podría leer el historial
 * y ejecutar tools. `SHIRO_BIND_HOST` es el opt-in consciente para abrirlo.
 */

/** Host por defecto: solo esta máquina. */
export const DEFAULT_BIND_HOST = '127.0.0.1';

export interface BindHost {
  /** Host que se pasa a `listen()`. */
  host: string;
  /** `true` si solo acepta conexiones de esta máquina. */
  isLoopback: boolean;
}

/** `127.0.0.0/8` completo, no solo `127.0.0.1`. */
const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

/**
 * Lee `SHIRO_BIND_HOST` del entorno. Ausente, vacío o en blanco → default.
 * No valida que el valor sea una IP: si no lo es, `listen()` falla al arrancar.
 */
export function resolveBindHost(env: NodeJS.ProcessEnv): BindHost {
  const raw = env.SHIRO_BIND_HOST?.trim();
  const host = raw === undefined || raw === '' ? DEFAULT_BIND_HOST : raw;
  const normalized = host.toLowerCase();
  const isLoopback =
    normalized === 'localhost' || normalized === '::1' || IPV4_LOOPBACK.test(normalized);
  return { host, isLoopback };
}
