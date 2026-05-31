/**
 * useCompanionState — hook que conecta el `companionReducer` al
 * EventBus. Devuelve `[state, dispatch]` para que componentes
 * inspeccionen el state y disparen acciones puntuales (e.g. RESET).
 *
 * Eventos suscritos (mapeo state ↔ EventBus, ver
 * `docs/architecture.md`):
 *
 *   stt:listening    → LISTEN_START
 *   stt:partial      → STT_PARTIAL
 *   stt:transcribed  → STT_FINAL  (apaga listening, limpia sttLive)
 *   user:message     → USER_SAID  (añade el mensaje del usuario al historial)
 *   router:routed    → THINK_START
 *   llm:responded    → SHIRO_REPLY
 *   tts:audio-ended  → SPEAK_END
 *   memory:snapshot  → HYDRATE_FROM_MEMORY  (rehidrata el chat al reconectar)
 *
 * Por qué `user:message` añade al historial y no `stt:transcribed`:
 *
 * El cliente emite `user:message` tanto cuando el usuario tipea como
 * cuando STT entrega una transcripción final (futuro). Unificar el
 * historial sobre ese evento mantiene el código DRY y permite que el
 * mensaje "Tú: hola" aparezca incluso sin STT (estado actual).
 *
 * `llm:chunk` no se consume aquí — lo procesará el TTS cuando llegue.
 */

import { useReducer } from 'react';
import { useBusEvent } from '../use-bus';
import {
  companionReducer,
  INITIAL_STATE,
  type CompanionAction,
  type CompanionState,
} from './companion-reducer';

export function useCompanionState(): [CompanionState, React.Dispatch<CompanionAction>] {
  const [state, dispatch] = useReducer(companionReducer, INITIAL_STATE);

  useBusEvent('stt:listening', () => {
    dispatch({ type: 'LISTEN_START' });
  });

  useBusEvent('stt:partial', (p) => {
    dispatch({ type: 'STT_PARTIAL', text: p.text });
  });

  useBusEvent('stt:transcribed', (p) => {
    dispatch({ type: 'STT_FINAL', text: p.text, userId: p.userId });
  });

  useBusEvent('user:message', (p) => {
    dispatch({ type: 'USER_SAID', text: p.text, userId: p.userId });
  });

  useBusEvent('router:routed', (p) => {
    dispatch({ type: 'THINK_START', tier: p.tier });
  });

  useBusEvent('llm:responded', (p) => {
    dispatch({
      type: 'SHIRO_REPLY',
      text: p.text,
      emotion: p.emotion,
      tier: p.tier,
      latencyMs: p.latencyMs,
    });
  });

  useBusEvent('tts:audio-ended', () => {
    dispatch({ type: 'SPEAK_END' });
  });

  useBusEvent('memory:snapshot', (p) => {
    dispatch({ type: 'HYDRATE_FROM_MEMORY', entries: p.entries });
  });

  return [state, dispatch];
}
