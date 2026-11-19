/**
 * `TurnTiming`: cuánto tarda cada etapa de un turno (P-16, R-134 y R-135).
 * El reloj se inyecta para que los tiempos del test sean exactos.
 */

import { describe, expect, it } from 'vitest';
import { TurnTiming, formatTurnTiming } from '../../../src/pipeline/turn-timing.js';

/** Un reloj que avanza solo cuando el test lo dice. */
function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 1_000;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('TurnTiming', () => {
  it('mide cada etapa y el total desde que empezó el turno', async () => {
    const clock = makeClock();
    const timing = new TurnTiming(clock.now);

    await timing.measure('route', () => {
      clock.advance(120);
      return Promise.resolve();
    });
    clock.advance(5); // lo que pasa entre etapas cuenta en el total, no en ninguna
    const result = await timing.measure('llm', () => {
      clock.advance(900);
      return Promise.resolve('respuesta');
    });

    expect(result).toBe('respuesta');
    expect(timing.stages()).toEqual({ route: 120, llm: 900 });
    expect(timing.elapsedMs()).toBe(1_025);
  });

  it('una etapa que se repite suma', async () => {
    const clock = makeClock();
    const timing = new TurnTiming(clock.now);
    const step = (ms: number) => () => {
      clock.advance(ms);
      return Promise.resolve();
    };

    // La nube falla y responde el modelo local: las dos llamadas son «llm».
    await timing.measure('llm', step(400));
    await timing.measure('llm', step(700));

    expect(timing.stages()).toEqual({ llm: 1_100 });
  });

  it('una etapa que falla también queda medida, y el error sigue su camino', async () => {
    const clock = makeClock();
    const timing = new TurnTiming(clock.now);

    await expect(
      timing.measure('llm', () => {
        clock.advance(250);
        return Promise.reject(new Error('sin modelo'));
      }),
    ).rejects.toThrow('sin modelo');

    expect(timing.stages()).toEqual({ llm: 250 });
  });

  it('redondea a milisegundos enteros', async () => {
    const clock = makeClock();
    const timing = new TurnTiming(clock.now);

    await timing.measure('context', () => {
      clock.advance(12.6);
      return Promise.resolve();
    });

    expect(timing.stages()).toEqual({ context: 13 });
    expect(timing.elapsedMs()).toBe(13);
  });

  it('lo que devuelve no se puede usar para cambiar lo medido', async () => {
    const timing = new TurnTiming(makeClock().now);
    await timing.measure('route', () => Promise.resolve());

    timing.stages().route = 999;

    expect(timing.stages()).toEqual({ route: 0 });
  });
});

describe('formatTurnTiming', () => {
  it('una línea con las etapas en el orden del turno y el total', () => {
    expect(
      formatTurnTiming({ tts: 410, llm: 900, route: 120, context: 35, persist: 2 }, 1_480),
    ).toBe('route=120ms context=35ms llm=900ms persist=2ms tts=410ms total=1480ms');
  });

  it('las etapas que no ocurrieron no salen', () => {
    expect(formatTurnTiming({ route: 120 }, 130)).toBe('route=120ms total=130ms');
  });
});
