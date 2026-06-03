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
 *   stt:transcribed  → STT_FINAL (apaga listening, limpia sttLive)
 *                      + re-emite `user:message` con el texto final,
 *                        para que un turno hablado entre al pipeline
 *                        conversacional por el MISMO camino que un
 *                        turno tipeado. Ver "Por qué…" abajo.
 *   user:message     → USER_SAID (añade el mensaje del usuario al historial)
 *   router:routed    → THINK_START
 *   llm:responded    → SHIRO_REPLY
 *   tts:audio-ended  → SPEAK_END
 *   memory:snapshot  → HYDRATE_FROM_MEMORY (rehidrata el chat al reconectar)
 *
 * Por qué `user:message` añade al historial y no `stt:transcribed`:
 *
 * El cliente emite `user:message` tanto cuando el usuario tipea (input
 * de texto) como cuando STT entrega una transcripción final (PTT real
 * del micro). Unificar el historial sobre ese evento mantiene el
 * código DRY y, más importante, hace que el flujo conversacional
 * server-side (router → LLM → memoria → tts) sea idéntico para texto
 * y voz — el server no distingue.
 *
 * Texto vacío del STT: si Whisper devuelve `""` (silencio puro, ruido,
 * VAD que cortó todo) NO emitimos `user:message`. Evita disparar un
 * turno sin contenido.
 *
 * Race condition multi-cliente: si dos clientes del mismo bus están
 * conectados y ambos suscriben este hook, ambos emitirían
 * `user:message` al recibir el mismo `stt:transcribed` broadcasted.
 * En V1 el desktop es el único origen de STT, así que el riesgo es
 * teórico — el día que múltiples clientes hablen habrá que añadir un
 * `origin` al payload del STT y filtrar aquí.
 *
 * `llm:chunk` no se consume aquí — lo procesará el TTS cuando llegue.
 */

import { useReducer } from 'react';
import { useBus, useBusEvent } from '../use-bus';
import {
  companionReducer,
  INITIAL_STATE,
  type CompanionAction,
  type CompanionState,
} from './companion-reducer';

export function useCompanionState(): [CompanionState, React.Dispatch<CompanionAction>] {
  const bus = useBus();
  const [state, dispatch] = useReducer(companionReducer, INITIAL_STATE);

  useBusEvent('stt:listening', () => {
    dispatch({ type: 'LISTEN_START' });
  });

  useBusEvent('stt:partial', (p) => {
    dispatch({ type: 'STT_PARTIAL', text: p.text });
  });

  useBusEvent('stt:transcribed', (p) => {
    dispatch({ type: 'STT_FINAL', text: p.text, userId: p.userId });
    // Solo turnos con contenido real. Whisper devuelve "" en silencios
    // puros o cuando el VAD recorta todo — no queremos invocar al LLM
    // por un PTT en blanco.
    const trimmed = p.text.trim();
    if (trimmed.length > 0) {
      void bus.emit('user:message', { text: trimmed, userId: p.userId });
    }
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
