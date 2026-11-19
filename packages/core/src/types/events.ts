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
import type { TurnFailureReason } from './turn-failure.js';

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
    /** `ELEVENLABS_API_KEY` presente (TTS de respaldo de Gemini). */
    elevenlabs: boolean;
    /** `GEMINI_API_KEY` presente (TTS primary, voz diseñada; ADR 0034). */
    gemini: boolean;
  };
  /**
   * Caducidad de la voz diseñada de Gemini (ADR 0034 §5). Solo existe si
   * `GeminiTTS` está en la cadena de TTS (con `unknown` si no se pudo
   * comprobar, p. ej. sin clave); se consulta una vez al arrancar y se
   * reutiliza. Puede faltar en los informes previos a que termine la consulta. Estado derivado: nunca lleva la clave.
   */
  geminiVoice?: GeminiVoiceStatus;
  /**
   * Lo que le falta a un servicio que **responde** para poder usarse. Ausente
   * cuando todo lo vivo está listo, o cuando no se pudo averiguar.
   */
  readiness?: ServiceReadiness;
  /** ISO timestamp del momento del chequeo. */
  checkedAt: string;
}

/**
 * Diferencia entre vivo y listo (R-280): un servicio puede contestar a su
 * healthcheck y aun así no servir.
 */
export interface ServiceReadiness {
  /** Modelos de la configuración que Ollama no tiene descargados. */
  ollamaMissingModels?: string[];
  /**
   * Whisper transcribe en CPU (`cpu`: funciona, más lento) o responde pero
   * todavía carga el modelo (`loading`: aún no transcribe). Hoy el servicio no
   * abre el puerto hasta cargar el modelo, así que `loading` no llega: mientras
   * carga, sale como caído. El valor queda previsto para cuando cargue en
   * segundo plano.
   */
  whisper?: 'loading' | 'cpu';
  /**
   * La clave de la nube está, pero el último turno que la usó acabó con la
   * nube rechazándola (`auth`) o sin cuota ni saldo (`quota`). Se borra cuando
   * la nube vuelve a responder. No se comprueba con una petición de prueba.
   */
  cloud?: 'auth' | 'quota';
}

/**
 * Estado de la voz diseñada de Gemini. `unknown` cubre sin clave, sin
 * `voice_id`, error de red y respuesta ilegible.
 */
export interface GeminiVoiceStatus {
  status: 'ok' | 'expiring' | 'expired' | 'missing' | 'unknown';
  /** Caducidad (ISO 8601 UTC). */
  expiresAt?: string;
  /** Días completos que faltan para caducar (0 si caduca en menos de un día). */
  daysLeft?: number;
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
  'secrets:save': { anthropic?: string; elevenlabs?: string; gemini?: string };

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

  /**
   * Un LLM no pudo responder. `reason` es una lista cerrada: el texto del
   * error no sale del servidor. El turno puede seguir con el otro modelo; si
   * después llega un `llm:responded` normal, solo falló ese `tier`. Ver la
   * nota del 2026-11-14 en ADR 0016.
   */
  'llm:failed': { reason: TurnFailureReason; tier: 'local' | 'cloud'; userId: string };

  // ─── Tiempos del turno ──────────────────────────────────────────────
  /**
   * Cuánto tardó cada etapa de un turno, en milisegundos. Lo emite el
   * core-host al final, cuando la voz de la respuesta ya está sintetizada:
   * `latencyMs` de `llm:responded` se corta antes, al tener el texto.
   *
   * `stages` lleva solo las etapas que ocurrieron (si el turno falla antes
   * de guardar la respuesta, no hay `persist`). `totalMs` va desde que
   * llegó `user:message` hasta que el audio quedó listo para pedirse.
   * `turnId` es el id del mensaje del usuario que abrió el turno.
   */
  'turn:measured': {
    userId: string;
    turnId: string;
    tier: 'local' | 'cloud';
    stages: { route?: number; context?: number; llm?: number; persist?: number; tts?: number };
    totalMs: number;
  };

  // ─── TTS (salida de voz) ────────────────────────────────────────────
  /**
   * Audio sintetizado disponible para reproducir. El `core-host` cachea
   * el buffer en memoria y expone una URL HTTP efímera; cada cliente
   * conectado decide si lo reproduce (toggle de mute por cliente). Ver
   * ADR 0020, decisión 3.
   *
   * `url` es la **ruta** del audio en el core-host (`/audio/<id>.<ext>`),
   * sin servidor ni puerto: cada cliente la resuelve contra el origen de su
   * conexión al bus, que es quien sabe cómo se llega al core-host desde su
   * máquina (enmienda del 2026-11-19 del ADR 0020). `mimeType` ayuda al
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

  // ─── Self-improvement (ADR 0023) ───────────────────────────────────
  /**
   * Progreso de una sesión de self-dev. La emite el `SelfDevSession` al
   * pasar de fase (setup → generar → eval → fix → PR → done). El cliente
   * muestra un indicador de estado discreto. No bloquea nada — es
   * informativo. Las **aprobaciones** (arrancar sesión / crear PR) NO van
   * por aquí: reusan `tool:requires-approval`/`tool:approval` (tools
   * `selfdev:propose` y `gh:pr-create` son `confirm`).
   */
  'selfdev:progress': {
    /** Correlaciona los eventos de una misma sesión. */
    sessionId: string;
    /** Tema libre que arrancó la sesión (para mostrar "trabajando en …"). */
    topic: string;
    /** Fase actual del flujo. */
    phase: 'setup' | 'generating' | 'eval' | 'fixing' | 'pr' | 'done';
    /** Detalle opcional legible (p.ej. qué check del eval falló). */
    message?: string;
  };
  /**
   * Fin de una sesión de self-dev. `ok:true` → PR abierto (`prUrl`).
   * `ok:false` → abortó (eval rojo tras los reintentos, PR no aprobado,
   * o error); `reason` lo explica y `branch` queda para inspección manual.
   */
  'selfdev:done': {
    sessionId: string;
    topic: string;
    ok: boolean;
    /** URL del PR si se creó (`ok:true`). */
    prUrl?: string;
    /** Rama `shiro/<topic>` (queda viva si `ok:false` para revisar). */
    branch?: string;
    /** Motivo del fallo cuando `ok:false`. */
    reason?: string;
  };

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
