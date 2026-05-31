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
 * - Eventos disparados por el usuario via cliente: prefijo `user:`.
 *
 * Cada evento añadido aquí es **automáticamente type-safe** en
 * `bus.emit` y `bus.on`. Si añades uno, considera también documentarlo
 * en `docs/architecture.md` (sección Mapeo state ↔ EventBus).
 */

import type { Emotion } from './emotions.js';
import type { MemoryEntry } from '../interfaces/IMemoryModule.js';

/*
 * EventMap es deliberadamente un interface con keys literales para que
 * `keyof EventMap` produzca una union de strings, no un indexed type.
 */

export interface EventMap {
  // ─── Bus / sistema ──────────────────────────────────────────────────
  /**
   * Se emite una sola vez en el arranque, cuando el EventBus termina
   * de instanciarse y registrarse en el Orchestrator.
   */
  'bus:ready': { startedAt: string };

  // ─── Usuario (origen: cliente desktop, mobile, etc.) ────────────────
  /**
   * El usuario envió un mensaje de texto (escribió + Enter, o el STT
   * entregó una transcripción final). Lo emiten los clientes; lo
   * consumen el HybridRouter y la Memory.
   */
  'user:message': { text: string; userId: string };

  // ─── STT (entrada de voz) ───────────────────────────────────────────
  /**
   * El micrófono empezó a capturar audio. UI muestra indicador de
   * escucha activa.
   */
  'stt:listening': { userId: string };

  /**
   * Transcripción parcial — el usuario sigue hablando. Útil para
   * mostrar texto en vivo mientras dicta. `text` es acumulativo.
   */
  'stt:partial': { text: string; userId: string };

  /**
   * Transcripción definitiva — VAD detectó fin de turno o el usuario
   * paró el push-to-talk. El cliente típicamente emite `user:message`
   * a continuación.
   */
  'stt:transcribed': { text: string; userId: string; isFinal: true };

  // ─── Router (decisión local vs cloud) ───────────────────────────────
  /**
   * El HybridRouter decidió qué tier de LLM atiende el mensaje. La UI
   * lo usa para mostrar "Pensando con Qwen/Claude".
   */
  'router:routed': { tier: 'local' | 'cloud'; userId: string };

  // ─── LLM (respuesta) ────────────────────────────────────────────────
  /**
   * Chunk de stream del LLM. `text` es el delta nuevo, no acumulativo.
   * Permite al TTS empezar a hablar antes de que termine el LLM.
   */
  'llm:chunk': { text: string; userId: string };

  /**
   * Respuesta completa del LLM. La UI actualiza subtítulos y el avatar
   * cambia expresión. Si emoción no se infiere, queda 'neutral'.
   */
  'llm:responded': {
    text: string;
    emotion: Emotion;
    userId: string;
    /** Útil para diagnóstico — qué tier respondió. */
    tier: 'local' | 'cloud';
    /** ms desde user:message hasta esta emisión. */
    latencyMs: number;
  };

  // ─── TTS (salida de voz) ────────────────────────────────────────────
  /**
   * El TTS terminó de reproducir el audio. La UI quita subtítulos y
   * el avatar vuelve a idle.
   */
  'tts:audio-ended': { userId: string };

  // ─── Memoria (sincronización con cliente) ───────────────────────────
  /**
   * Snapshot del historial reciente que el server empuja al detectar
   * una nueva conexión WebSocket. El cliente hidrata su reducer con
   * estos `entries` para que el chat sobreviva a recargas del navegador
   * (la memoria de verdad vive en Letta + WAL, ver ADRs 0017 y 0018).
   *
   * El reducer del cliente aplica el snapshot **solo si su historial
   * está vacío** — clientes que ya tienen turnos en sesión lo ignoran
   * (idempotencia). Ver `companion-reducer.ts`.
   */
  'memory:snapshot': { entries: MemoryEntry[]; userId: string };
}

/**
 * Helper: el conjunto de nombres de evento válidos como union de strings.
 * Útil en tests y validaciones que necesiten enumerar todos los eventos.
 */
export type EventName = keyof EventMap;
