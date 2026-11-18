/**
 * Texto del aviso cuando un LLM no pudo responder (`llm:failed`).
 *
 * El servidor manda solo el motivo, de una lista cerrada; lo que se le dice
 * a la persona se escribe aquí, en primera persona y con lo que puede hacer.
 * Ver la nota del 2026-11-14 en ADR 0016.
 */

import type { TurnFailureReason } from '@proyecto-shiro/core';
import type { TurnFailure } from './companion-reducer';

/** Tras un fallo de la nube el turno sigue en local: se dice siempre. */
const CLOUD_FALLBACK = 'Sigo con el modelo local.';

const CLOUD_TEXT: Record<TurnFailureReason, string> = {
  'missing-key': 'No tengo clave para el modelo de la nube. Puedes ponerla en Setup.',
  auth: 'La nube rechazó mi clave: puede estar mal escrita o caducada. Revísala en Setup.',
  quota: 'La nube dice que llegué al límite de uso o que no queda saldo.',
  unavailable: 'No pude conectar con el modelo de la nube.',
  'model-missing': 'La nube no conoce el modelo que tengo configurado.',
  unknown: 'El modelo de la nube falló.',
};

const LOCAL_FALLBACK = 'El modelo local falló y no pude responder.';

const LOCAL_TEXT: Partial<Record<TurnFailureReason, string>> = {
  unavailable: 'No pude hablar con Ollama. Comprueba que está abierto.',
  'model-missing':
    'A Ollama le falta el modelo que tengo configurado. Descárgalo con «ollama pull» y vuelve a intentarlo.',
};

export function describeTurnFailure(failure: TurnFailure): string {
  if (failure.tier === 'cloud') return `${CLOUD_TEXT[failure.reason]} ${CLOUD_FALLBACK}`;
  return LOCAL_TEXT[failure.reason] ?? LOCAL_FALLBACK;
}
