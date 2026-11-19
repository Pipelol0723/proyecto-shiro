/**
 * Cuánto tarda cada etapa de un turno (P-16, R-134 y R-135).
 *
 * Antes solo había un número, `latencyMs`, que se cortaba al tener el texto:
 * dejaba fuera guardar la respuesta y sintetizar la voz, que es lo que se
 * oye. Sin el reparto por etapas no se podía saber dónde se iba el tiempo.
 */

import type { EventMap } from '@proyecto-shiro/core';

/** Milisegundos por etapa, como viajan en `turn:measured`. Una etapa que no ocurrió no aparece. */
export type TurnStageTimes = EventMap['turn:measured']['stages'];

export type TurnStage = keyof TurnStageTimes;

/** Las etapas del turno, en el orden en que ocurren. */
export const TURN_STAGES: readonly TurnStage[] = ['route', 'context', 'llm', 'persist', 'tts'];

export class TurnTiming {
  private readonly startedAt: number;
  /** Tiempo acumulado por etapa, sin redondear. */
  private readonly spent = new Map<TurnStage, number>();

  /** `now` es un reloj monótono en milisegundos; se inyecta en los tests. */
  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
  }

  /**
   * Ejecuta `run` y apunta lo que tardó a `stage`. Si la etapa se repite, se
   * suma. Si `run` falla, lo tardado queda apuntado y el error sigue.
   */
  async measure<T>(stage: TurnStage, run: () => Promise<T>): Promise<T> {
    const begin = this.now();
    try {
      return await run();
    } finally {
      this.spent.set(stage, (this.spent.get(stage) ?? 0) + (this.now() - begin));
    }
  }

  /** Milisegundos desde que empezó el turno. */
  elapsedMs(): number {
    return Math.round(this.now() - this.startedAt);
  }

  /** Lo medido hasta ahora, en milisegundos enteros. Devuelve una copia. */
  stages(): TurnStageTimes {
    const result: TurnStageTimes = {};
    for (const stage of TURN_STAGES) {
      const ms = this.spent.get(stage);
      if (ms !== undefined) result[stage] = Math.round(ms);
    }
    return result;
  }
}

/**
 * Lo que no es de ninguna etapa: emitir los eventos del turno y esperar a
 * quien los escucha, guardar el mensaje del usuario… Las etapas no suman el
 * total, y la diferencia se dice para que las cuentas cuadren.
 */
export function unaccountedMs(stages: TurnStageTimes, totalMs: number): number {
  const measured = TURN_STAGES.reduce((sum, stage) => sum + (stages[stage] ?? 0), 0);
  return Math.max(0, totalMs - measured);
}

/** Una línea para el log: `route=120ms context=35ms llm=900ms … resto=13ms total=1480ms`. */
export function formatTurnTiming(stages: TurnStageTimes, totalMs: number): string {
  const parts = TURN_STAGES.filter((stage) => stages[stage] !== undefined).map(
    (stage) => `${stage}=${String(stages[stage])}ms`,
  );
  const rest = unaccountedMs(stages, totalMs);
  if (rest > 0) parts.push(`resto=${String(rest)}ms`);
  return [...parts, `total=${String(totalMs)}ms`].join(' ');
}
