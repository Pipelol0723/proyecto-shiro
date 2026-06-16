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

/** Estado de un servicio externo en el healthcheck del sistema. */
export type ServiceStatus = 'ok' | 'down';

/**
 * Reporte de salud del sistema que el `core-host` produce chequeando los
 * servicios externos (Ollama, Letta, Whisper) y la presencia de las API
 * keys. Lo consume el setup wizard del cliente para mostrar qué falta y
 * cómo arreglarlo. El chequeo es **server-side** (el sidecar tiene acceso
 * de red directo y conoce `process.env`), evitando problemas de CORS si
 * el webview intentara los fetches.
 *
 * **Nunca incluye el valor de las keys** — solo su presencia (boolean).
 */
export interface SystemHealthReport {
  services: {
    /** Ollama (`/api/tags`) — LLM local + clasificador del router. */
    ollama: ServiceStatus;
    /** Letta (`/v1/health/`) — memoria semántica. */
    letta: ServiceStatus;
    /** Microservicio Whisper (`/health`) — STT. */
    whisper: ServiceStatus;
  };
  secrets: {
    /** `ANTHROPIC_API_KEY` presente (LLM cloud / Claude). */
    anthropic: boolean;
    /** `ELEVENLABS_API_KEY` presente (TTS primary). */
    elevenlabs: boolean;
  };
  /** ISO timestamp del momento del chequeo. */
  checkedAt: string;
}

export interface EventMap {
  // ─── Bus / sistema ──────────────────────────────────────────────────
  /**
   * Se emite una sola vez en el arranque, cuando el EventBus termina
   * de instanciarse y registrarse en el Orchestrator.
   */
  'bus:ready': { startedAt: string };

  /**
   * El cliente pide un (re)chequeo de salud del sistema. El `core-host`
   * responde con `system:health`. Sin payload relevante — `requestedBy`
   * es opcional para diagnóstico.
   */
  'system:health-check': { requestedBy?: string };

  /**
   * Reporte de salud del sistema. El `core-host` lo emite al arrancar,
   * al conectar un cliente nuevo, y en respuesta a `system:health-check`.
   * El setup wizard del cliente lo renderiza. Ver ADR 0024 §6.
   */
  'system:health': SystemHealthReport;

  /**
   * El cliente envía API keys para persistirlas en el binario empaquetado
   * (sin tener que tocar `.env` a mano). El `core-host` las escribe a un
   * `secrets.env` en su directorio de datos; tomarán efecto al reiniciar
   * la app (los módulos LLM/TTS leen las keys al construirse). Ver ADR
   * 0024 §6.
   *
   * Cada campo es opcional: solo se actualiza el que llega. Un string
   * vacío **borra** esa key. El valor viaja por el WS local (mismo origen
   * que el resto del bus) y nunca se loguea.
   */
  'secrets:save': { anthropic?: string; elevenlabs?: string };

  /**
   * Ack del `core-host` tras intentar persistir las keys. `restartRequired`
   * es `true` cuando se guardó algo nuevo: el cliente avisa al usuario que
   * reinicie para aplicarlas.
   */
  'secrets:saved': { ok: boolean; restartRequired: boolean; error?: string };

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
   * Audio sintetizado disponible para reproducir. El `core-host` cachea
   * el buffer en memoria y expone una URL HTTP efímera; cada cliente
   * conectado decide si lo reproduce (toggle de mute por cliente). Ver
   * ADR 0020, decisión 3.
   *
   * `url` apunta al endpoint HTTP del core-host. `mimeType` ayuda al
   * cliente a configurar el elemento `<audio>`. `duration` no viene del
   * server — el cliente la mide post-fetch.
   */
  'tts:audio': {
    url: string;
    audioId: string;
    mimeType: string;
    userId: string;
  };
  /**
   * Cancelación de la reproducción en curso. El cliente lo emite cuando
   * detecta nuevo input mientras Shiro habla (PTT o user:message). El
   * server invalida el `audioId` del cache; clientes que reproducían ese
   * id paran el audio. Ver ADR 0020, decisión 4.
   */
  'tts:cancel': { audioId: string; userId: string };
  /**
   * El cliente terminó de reproducir el audio. La UI quita subtítulos y
   * el avatar vuelve a idle. El cliente lo emite cuando el
   * `HTMLAudioElement` dispara `ended` (o tras `tts:cancel`).
   */
  'tts:audio-ended': { userId: string; audioId?: string };

  // ─── Tools agénticas (aprobación, ADR 0022 §4) ─────────────────────
  /**
   * El pipeline pide aprobación humana antes de ejecutar una tool `confirm`
   * (`fs:write`, `fs:delete`, `shell:exec`). El loop tool-use queda
   * **pausado** hasta que el cliente responde con `tool:approval` (mismo
   * `requestId`). El cliente materializa un modal de aprobación.
   */
  'tool:requires-approval': {
    /** Correlaciona la petición con su respuesta `tool:approval`. */
    requestId: string;
    /** Id namespaced de la tool (p.ej. `fs:write`). */
    toolId: string;
    /** Nombre LLM-safe de la tool (p.ej. `fs_write`). */
    toolName: string;
    /** Resumen legible de lo que se va a ejecutar (args truncados). */
    argsPreview: string;
    userId: string;
  };
  /**
   * Decisión del usuario sobre una `tool:requires-approval`. La emite el
   * cliente al pulsar "Permitir una vez" (`approved:true`) o "Cancelar"
   * (`approved:false`). El server ejecuta la tool o la cancela.
   */
  'tool:approval': { requestId: string; approved: boolean; userId: string };

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
