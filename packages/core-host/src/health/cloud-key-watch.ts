/**
 * cloud-key-watch — recuerda si la nube rechazó la clave o se quedó sin cuota.
 *
 * El asistente de configuración solo sabe si la clave **está**; una clave mal
 * escrita, caducada o sin saldo salía en verde mientras cada turno caía al
 * modelo local en silencio (R-296). No se hace ninguna petición de prueba: el
 * estado sale de lo que ya pasa en los turnos (`llm:failed` y `llm:responded`,
 * ver la nota del 2026-11-14 en ADR 0016).
 */

import type { EventMap, IEventBus, ServiceReadiness } from '@proyecto-shiro/core';

/** Lo que se sabe de la clave de la nube por el último turno que la usó. */
export type CloudKeyIssue = NonNullable<ServiceReadiness['cloud']>;

export interface CloudKeyWatch {
  /** El problema anotado, o `undefined` si no hay ninguno conocido. */
  current(): CloudKeyIssue | undefined;
  dispose(): void;
}

/**
 * Escucha los turnos y llama a `onChange` cada vez que cambia lo que se sabe.
 *
 * - Un fallo `auth` o `quota` del nivel nube lo anota.
 * - Una respuesta de la nube lo borra: la clave funciona.
 * - Los demás fallos de la nube (red, modelo, desconocido) no dicen nada de la
 *   clave: ni anotan ni borran. Tampoco los del modelo local.
 */
export function watchCloudKey(
  bus: IEventBus<EventMap>,
  onChange: (issue: CloudKeyIssue | undefined) => void,
): CloudKeyWatch {
  let issue: CloudKeyIssue | undefined;

  const set = (next: CloudKeyIssue | undefined): void => {
    if (next === issue) return;
    issue = next;
    onChange(issue);
  };

  const offFailed = bus.on('llm:failed', (p) => {
    if (p.tier !== 'cloud') return;
    if (p.reason === 'auth' || p.reason === 'quota') set(p.reason);
  });
  const offResponded = bus.on('llm:responded', (p) => {
    if (p.tier === 'cloud') set(undefined);
  });

  return {
    current: () => issue,
    dispose: () => {
      offFailed();
      offResponded();
    },
  };
}
