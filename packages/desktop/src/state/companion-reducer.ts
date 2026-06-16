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

import type { Emotion, MemoryEntry } from '@proyecto-shiro/core';

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
  | { type: 'USER_SAID'; text: string; userId: string }
  | { type: 'THINK_START'; tier: LLMTier }
  | { type: 'SHIRO_REPLY'; text: string; emotion: Emotion; tier: LLMTier; latencyMs: number }
  | { type: 'SPEAK_END' }
  | { type: 'SET_EMOTION'; emotion: Emotion }
  | { type: 'HYDRATE_FROM_MEMORY'; entries: MemoryEntry[] }
  | { type: 'RESET' };

/**
 * Mapea un `MemoryEntry` (server-side) a un `CompanionMessage` (UI). El
 * cambio sutil: `MemoryEntry.role` es `'user' | 'assistant' | 'tool'` y el
 * chat de la UI usa `'user' | 'shiro'`. Los turnos `tool` (acciones agénticas,
 * ADR 0022 §6) son memoria interna y se filtran antes de llegar aquí. La
 * metadata rica (emoción, tier, latencia) viaja en `MemoryEntry.metadata`;
 * aquí la desempacamos.
 */
function entryToMessage(entry: MemoryEntry): CompanionMessage {
  const role: 'user' | 'shiro' = entry.role === 'assistant' ? 'shiro' : 'user';
  const meta = entry.metadata ?? {};
  const message: CompanionMessage = {
    role,
    text: entry.text,
    timestamp: entry.timestamp,
  };
  if (role === 'shiro') {
    if (typeof meta.emotion === 'string') {
      message.emotion = meta.emotion as Emotion;
    }
    if (meta.tier === 'local' || meta.tier === 'cloud') {
      message.tier = meta.tier;
    }
    if (typeof meta.latencyMs === 'number') {
      message.latencyMs = meta.latencyMs;
    }
  }
  return message;
}

export function companionReducer(state: CompanionState, action: CompanionAction): CompanionState {
  switch (action.type) {
    case 'LISTEN_START':
      return { ...state, listening: true, sttLive: '', subtitle: '' };

    case 'STT_PARTIAL':
      return { ...state, sttLive: action.text };

    case 'STT_FINAL':
      // Solo transición de estado. El mensaje al historial lo añade
      // `USER_SAID` cuando llegue `user:message` por el bus (lo dispara
      // el cliente al tipear, o el adaptador STT tras una transcripción
      // final). Así el historial recibe input sea tipeado o hablado por
      // un único camino.
      return { ...state, listening: false, sttLive: '' };

    case 'USER_SAID':
      return {
        ...state,
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

    case 'HYDRATE_FROM_MEMORY':
      // Idempotente: solo aplicamos el snapshot si el historial está
      // vacío. Si el cliente ya tenía turnos en esta sesión (porque ya
      // se hidrató o porque el usuario habló), ignoramos snapshots
      // posteriores para no duplicar. RESET vuelve a habilitar la
      // hidratación.
      if (state.history.length > 0) return state;
      return {
        ...state,
        history: action.entries.filter((e) => e.role !== 'tool').map(entryToMessage),
      };

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
