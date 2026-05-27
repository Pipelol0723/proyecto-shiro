/**
 * Reducer del state del companion — alimentado por eventos del EventBus.
 *
 * Patrón: el cliente mantiene una "vista" del estado del companion
 * (qué emoción tiene, si está hablando, historial de conversación).
 * Los eventos del bus producen actions; el reducer las aplica.
 *
 * **Pure function** — sin side effects. El wiring del bus al reducer
 * vive en `useCompanionState` (hook aparte). Esto permite tests
 * unitarios triviales del reducer.
 *
 * Ver ADR 0010 (wiring cliente↔core) y `docs/architecture.md`
 * (sección Mapeo state ↔ EventBus).
 */

import type { Emotion } from '@proyecto-shiro/core';

export type LLMTier = 'local' | 'cloud';

export interface CompanionMessage {
  role: 'user' | 'shiro';
  text: string;
  /** ISO timestamp del momento de añadir el mensaje al historial. */
  timestamp: string;
  /** Solo en mensajes de Shiro. */
  emotion?: Emotion;
  tier?: LLMTier;
  latencyMs?: number;
}

export interface CompanionState {
  /** Emoción actual del avatar/orbe. */
  emotion: Emotion;
  /** ¿El TTS está reproduciendo? */
  speaking: boolean;
  /** ¿El micrófono está activo capturando? */
  listening: boolean;
  /** ¿El router/LLM está procesando? */
  thinking: boolean;
  /** Tier elegido para el procesamiento en curso. */
  routedTo: LLMTier | null;
  /** Texto en vivo del STT mientras el usuario habla. */
  sttLive: string;
  /** Subtítulo de Shiro mientras habla (vacío cuando no). */
  subtitle: string;
  /** Historial completo de conversación. */
  history: CompanionMessage[];
}

export const INITIAL_STATE: CompanionState = {
  emotion: 'neutral',
  speaking: false,
  listening: false,
  thinking: false,
  routedTo: null,
  sttLive: '',
  subtitle: '',
  history: [],
};

export type CompanionAction =
  | { type: 'LISTEN_START' }
  | { type: 'STT_PARTIAL'; text: string }
  | { type: 'STT_FINAL'; text: string; userId: string }
  | { type: 'THINK_START'; tier: LLMTier }
  | { type: 'SHIRO_REPLY'; text: string; emotion: Emotion; tier: LLMTier; latencyMs: number }
  | { type: 'SPEAK_END' }
  | { type: 'SET_EMOTION'; emotion: Emotion }
  | { type: 'RESET' };

export function companionReducer(state: CompanionState, action: CompanionAction): CompanionState {
  switch (action.type) {
    case 'LISTEN_START':
      return { ...state, listening: true, sttLive: '', subtitle: '' };

    case 'STT_PARTIAL':
      return { ...state, sttLive: action.text };

    case 'STT_FINAL':
      return {
        ...state,
        listening: false,
        sttLive: '',
        history: [
          ...state.history,
          { role: 'user', text: action.text, timestamp: new Date().toISOString() },
        ],
      };

    case 'THINK_START':
      return { ...state, thinking: true, routedTo: action.tier };

    case 'SHIRO_REPLY':
      return {
        ...state,
        thinking: false,
        speaking: true,
        emotion: action.emotion,
        subtitle: action.text,
        history: [
          ...state.history,
          {
            role: 'shiro',
            text: action.text,
            emotion: action.emotion,
            tier: action.tier,
            latencyMs: action.latencyMs,
            timestamp: new Date().toISOString(),
          },
        ],
      };

    case 'SPEAK_END':
      return { ...state, speaking: false, subtitle: '' };

    case 'SET_EMOTION':
      return { ...state, emotion: action.emotion };

    case 'RESET':
      return INITIAL_STATE;

    default: {
      // Exhaustive check — si añades una acción nueva al union, TS
      // detecta el switch faltante.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
