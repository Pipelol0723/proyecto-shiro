/**
 * Mapa central de eventos del sistema — `EventMap`.
 *
 * Cada entrada es:
 *   '<modulo>:<verbo>': <forma del payload>
 *
 * Convención de naming (ver ADR 0005):
 * - Módulo en kebab-case minúscula: `stt`, `llm`, `tts`, `avatar`, `memory`.
 * - Eventos discretos: verbo en participio/pasado (`transcribed`,
 *   `responded`, `failed`, `saved`).
 * - Eventos de stream: verbo en presente (`chunk`, `tick`).
 * - Eventos del propio bus o sistema: prefijo `bus:` o `system:`.
 *
 * Por ahora arranca minimal — se llenan en Fases 2+ a medida que cada
 * módulo concreto se implementa. Cada evento nuevo añadido aquí es
 * automáticamente type-safe en `bus.emit` y `bus.on`.
 */

export interface EventMap {
  /**
   * Se emite una sola vez en el arranque, cuando el EventBus termina
   * de instanciarse y registrarse en el Orchestrator. Útil como
   * heartbeat inicial y para tests de smoke.
   */
  'bus:ready': { startedAt: string };
}

/**
 * Helper: el conjunto de nombres de evento válidos como union de strings.
 * Útil en tests y validaciones que necesiten enumerar todos los eventos.
 */
export type EventName = keyof EventMap;
