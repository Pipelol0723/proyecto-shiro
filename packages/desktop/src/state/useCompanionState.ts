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
 *   stt:transcribed  → STT_FINAL
 *   router:routed    → THINK_START
 *   llm:responded    → SHIRO_REPLY
 *   tts:audio-ended  → SPEAK_END
 *
 * El cliente NO se suscribe a `user:message` ni a `llm:chunk` aquí
 * — `user:message` lo emite el cliente, y `llm:chunk` lo consume el
 * TTS, no el state visual.
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

  return [state, dispatch];
}
