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
}

/**
 * Registra los dos manejadores y devuelve la función que los quita.
 *
 * - **Promesa rechazada sin manejar**: se registra y el proceso sigue. Es un
 *   fallo de una operación suelta; lo demás sigue sirviendo.
 * - **Excepción sin capturar**: se registra y el proceso sale con código 1.
 *   El estado ya no es de fiar, y el código distinto de 0 le dice al lanzador
 *   que fue una caída.
 */
export function installProcessSafetyNet(
  logger: Logger,
  options: ProcessSafetyNetOptions = {},
): () => void {
  const proc = options.proc ?? process;
  const exit = options.exit ?? ((code: number): void => process.exit(code));

  const onRejection = (err: unknown): void => {
    logger.error('promesa rechazada sin manejar; el core-host sigue', { err });
  };
  const onException = (err: unknown): void => {
    logger.error('excepción sin capturar; el core-host se cierra', { err });
    exit(1);
  };

  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return () => {
    proc.off('unhandledRejection', onRejection);
    proc.off('uncaughtException', onException);
  };
}
