/**
 * Selección del motor del avatar (ADR 0028 §3): se recorre una lista ordenada
 * de candidatos y se monta el primero que esté disponible.
 *
 * Es una función sin React para poder probarla con motores falsos. Quien la
 * llama pinta el orbe mientras tanto y cuando devuelve `null`.
 */

import type { AvatarCandidate, AvatarEngineComponent, AvatarEngineDefinition } from './types';

/**
 * Tiempo límite de cada comprobación. Sin él, una petición colgada del primer
 * candidato dejaría la cadena parada en el orbe aunque hubiera otro modelo.
 */
export const PROBE_TIMEOUT_MS = 4_000;

export interface AvatarSelection {
  candidate: AvatarCandidate;
  Component: AvatarEngineComponent;
  /** Posición del candidato en la lista: para seguir por el siguiente si falla. */
  index: number;
}

export interface SelectEngineOptions {
  /** Al abortarla (desmontaje, lista nueva) no se elige nada ni se sigue comprobando. */
  signal: AbortSignal;
  /** Primer candidato a comprobar. Por defecto, el primero. */
  from?: number;
  timeoutMs?: number;
}

/**
 * Devuelve el primer candidato montable desde `from`, o `null` si no hay
 * ninguno. Nunca lanza: un candidato cuyo motor no se conoce, cuya
 * comprobación falla, lanza o no responde a tiempo, o cuyo motor no carga, se
 * salta.
 */
export async function selectEngine(
  candidates: readonly AvatarCandidate[],
  engines: readonly AvatarEngineDefinition[],
  options: SelectEngineOptions,
): Promise<AvatarSelection | null> {
  const { signal, from = 0, timeoutMs = PROBE_TIMEOUT_MS } = options;

  for (let index = from; index < candidates.length; index += 1) {
    if (signal.aborted) return null;
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const engine = engines.find((e) => e.kind === candidate.kind);
    if (engine === undefined) continue;

    const available = await probeWithTimeout(engine, candidate, signal, timeoutMs);
    if (signal.aborted) return null;
    if (!available) continue;

    try {
      const Component = await engine.load();
      if (signal.aborted) return null;
      return { candidate, Component, index };
    } catch {
      // El código del motor no cargó (falta el chunk, falla al evaluarse).
    }
  }
  return null;
}

/**
 * Lanza la comprobación con su propio límite de tiempo. Resuelve a `false` si
 * dice que no, lanza, no responde a tiempo o se cancela desde fuera. Una
 * respuesta que llega después se ignora.
 */
function probeWithTimeout(
  engine: AvatarEngineDefinition,
  candidate: AvatarCandidate,
  outer: AbortSignal,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const inner = new AbortController();
    let settled = false;

    const finish = (available: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outer.removeEventListener('abort', cancel);
      resolve(available);
    };
    const cancel = (): void => {
      inner.abort();
      finish(false);
    };

    const timer = setTimeout(cancel, timeoutMs);
    outer.addEventListener('abort', cancel);

    // `Promise.resolve().then` y no una llamada directa: si `probe` lanza al
    // llamarse, también cuenta como «no».
    void Promise.resolve()
      .then(() => engine.probe(candidate, inner.signal))
      .then(
        (available) => {
          finish(available);
        },
        () => {
          finish(false);
        },
      );
  });
}
