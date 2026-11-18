/**
 * Red de seguridad del proceso core-host (R-169).
 *
 * Sin esto, una promesa rechazada sin manejar tumba el sidecar sin dejar
 * rastro: Node la convierte en excepción y el proceso muere con la traza en
 * stderr, que el lanzador no guarda. Aquí las dos salidas quedan en el log,
 * con el error entero (el logger recorre `cause`).
 */

import type { Logger } from '@proyecto-shiro/core';

/** Lo que se usa de `process`; los tests pasan un `EventEmitter`. */
interface ProcessEvents {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (err: unknown) => void): unknown;
  off(event: 'unhandledRejection' | 'uncaughtException', listener: (err: unknown) => void): unknown;
}

export interface ProcessSafetyNetOptions {
  proc?: ProcessEvents;
  exit?: (code: number) => void;
  /** Avisa cuando lo ya escrito en stderr ha salido del proceso. */
  flush?: (done: () => void) => void;
  /** `false` mientras el core-host arranca. Por defecto, siempre listo. */
  isReady?: () => boolean;
}

/** Espera máxima al volcado del log antes de salir de todas formas. */
const FLUSH_TIMEOUT_MS = 500;
/** Recorte del texto de una razón que no es un Error. */
const MAX_REASON_LENGTH = 200;

/**
 * Registra los dos manejadores y devuelve la función que los quita.
 *
 * - **Promesa rechazada sin manejar**: se registra y el proceso sigue. Es un
 *   fallo de una operación suelta; lo demás sigue sirviendo. Durante el
 *   arranque (`isReady` en `false`) cierra el proceso, como hacía Node antes
 *   de existir esta red: un core-host a medio arrancar no sirve a nadie.
 * - **Excepción sin capturar**: se registra y el proceso sale con código 1.
 *   El estado ya no es de fiar, y el código distinto de 0 le dice al lanzador
 *   que fue una caída.
 *
 * Registrar nunca impide salir: si el logger lanza, se sale igual. Y no se
 * sale hasta que stderr ha soltado lo escrito (o pasa `FLUSH_TIMEOUT_MS`),
 * porque `process.exit` corta las escrituras pendientes.
 */
export function installProcessSafetyNet(
  logger: Logger,
  options: ProcessSafetyNetOptions = {},
): () => void {
  const proc = options.proc ?? process;
  const exit = options.exit ?? ((code: number): void => process.exit(code));
  const flush =
    options.flush ??
    ((done: () => void): void => {
      process.stderr.write('', () => {
        done();
      });
    });
  const isReady = options.isReady ?? ((): boolean => true);

  const record = (message: string, reason: unknown): void => {
    try {
      logger.error(message, { err: toError(reason) });
    } catch {
      // Un log roto (p. ej. EPIPE) no puede tumbar el manejador ni impedir la salida.
    }
  };

  const leave = (): void => {
    let left = false;
    const go = (): void => {
      if (left) return;
      left = true;
      exit(1);
    };
    const timer = setTimeout(go, FLUSH_TIMEOUT_MS);
    const flushed = (): void => {
      clearTimeout(timer);
      go();
    };
    try {
      flush(flushed);
    } catch {
      flushed();
    }
  };

  const onRejection = (reason: unknown): void => {
    if (isReady()) {
      record('promesa rechazada sin manejar; el core-host sigue', reason);
      return;
    }
    record('promesa rechazada sin manejar durante el arranque; el core-host se cierra', reason);
    leave();
  };
  const onException = (err: unknown): void => {
    record('excepción sin capturar; el core-host se cierra', err);
    leave();
  };

  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return () => {
    proc.off('unhandledRejection', onRejection);
    proc.off('uncaughtException', onException);
  };
}

/**
 * Una promesa se puede rechazar con cualquier cosa. El logger solo trata con
 * cuidado los `Error`; un objeto suelto se volcaría entero (cabeceras, cuerpos)
 * y `undefined` no dejaría nada. Aquí todo acaba siendo un `Error`, y de un
 * objeto solo se anota que lo era.
 */
function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const text =
    typeof reason === 'string' ||
    typeof reason === 'number' ||
    typeof reason === 'boolean' ||
    typeof reason === 'bigint' ||
    reason === undefined ||
    reason === null
      ? String(reason).slice(0, MAX_REASON_LENGTH)
      : '[object]';
  return new Error(`razón que no es un Error: ${text}`);
}
