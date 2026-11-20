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
 * - Una respuesta de la nube lo borra: la clave funciona. Solo cuenta la de un
 *   turno que el router mandó a la nube (`router:routed`) y que no falló por
 *   el camino. El reporte hablado de self-dev también emite `llm:responded`
 *   con el nivel nube, pero no llama a la nube: no prueba nada de la clave.
 * - Una respuesta sin texto de la nube (`empty`) también lo borra: es un fallo
 *   del turno, pero la nube contestó.
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

  // Hay un turno en curso que el router mandó a la nube y aún no ha fallado.
  let cloudTurnOpen = false;

  const offRouted = bus.on('router:routed', (p) => {
    cloudTurnOpen = p.tier === 'cloud';
  });
  const offFailed = bus.on('llm:failed', (p) => {
    if (p.tier !== 'cloud') return;
    if (p.reason === 'empty' && cloudTurnOpen) set(undefined);
    cloudTurnOpen = false;
    if (p.reason === 'auth' || p.reason === 'quota') set(p.reason);
  });
  const offResponded = bus.on('llm:responded', (p) => {
    if (p.tier === 'cloud' && cloudTurnOpen) set(undefined);
    cloudTurnOpen = false;
  });

  return {
    current: () => issue,
    dispose: () => {
      offRouted();
      offFailed();
      offResponded();
    },
  };
}
