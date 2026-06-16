/**
 * Pipeline conversacional real — sustituye al `wireMockConversationFlow`
 * del PR 3 cuando todos los módulos (LLM local, LLM cloud, router, memoria)
 * son implementaciones reales.
 *
 * Flujo por turno:
 *   user:message
 *     → memory.save (user)  [fire-and-forget, en paralelo con todo lo siguiente]
 *     → router.route() → router:routed
 *     → memory.getRecent + searchSemantic (con timeout) → context string
 *     → llm.generate(context) → llm:responded
 *     → memory.save (assistant)
 *     → (transitional) tts:audio-ended simulado por duración del texto
 *
 * El save del user msg no bloquea el resto: el WAL local (SQLite síncrono)
 * captura la entrada en sub-ms y el push a Letta vive en background. Para
 * el reply del assistant sí esperamos: si el usuario manda dos turnos muy
 * seguidos, el `getRecent` del segundo necesita ver el reply del primero
 * en Letta.
 *
 * Errores de memoria nunca rompen el turno — el WAL del MemoryManager
 * garantiza que el user msg ya quedó en SQLite incluso si Letta hace
 * timeout. Si los reads de memoria tardan más del timeout, el turno
 * procede sin contexto (Shiro responde "ciego" ese turno).
 *
 * Cuando llegue el TTS real (hito posterior), el simulado de
 * `tts:audio-ended` se elimina — el módulo TTS lo emitirá cuando
 * termine la reproducción real.
 *
 * Ver ADR 0016 (wiring) y ADR 0017 (memoria, sección "Recuperación").
 */

import { randomUUID } from 'node:crypto';
import type {
  EventMap,
  IEventBus,
  IMemoryModule,
  ITTSModule,
  LLMResponse,
  LoadedModules,
  Logger,
  MemoryEntry,
} from '@proyecto-shiro/core';
import type { AudioCache } from '../audio/audio-cache.js';
import { buildToolDefs, makeToolExecutor } from './tool-loop.js';
import { createApprovalGate } from './approval-gate.js';

export interface MemoryReadsConfig {
  /** Cantidad de turnos cronológicos recientes a inyectar como contexto. */
  recentLimit: number;
  /** Cantidad de turnos semánticos relevantes a inyectar (si Letta está). */
  semanticLimit: number;
  /** Timeout máximo para las llamadas de lectura de memoria en el hot path. */
  timeoutMs: number;
}

export interface WireConversationFlowOptions {
  bus: IEventBus<EventMap>;
  modules: LoadedModules;
  /**
   * System prompt pre-construido a partir del personaje. Se reusa
   * turn a turn sin recomputar (lo construye `buildSystemPrompt`
   * en bootstrap).
   */
  systemPrompt: string;
  logger: Logger;
  /**
   * Escala los timers internos del TTS simulado (solo cuando NO hay
   * `audioCache` configurado, es decir, en tests legacy sin TTS real).
   * 1 = duración humana. 0 = inmediato (tests). Default 1.
   */
  simulationSpeed?: number;
  /**
   * Parámetros de lectura de memoria. Si se omite, defaults seguros
   * (5/3/1500ms) — pero el bootstrap real los toma del YAML vía
   * `MemoryManager.getPipelineConfig()`.
   */
  memoryReads?: MemoryReadsConfig;
  /**
   * Cache de buffers de audio TTS + origin HTTP del server. Cuando se
   * pasa, el pipeline sintetiza con `modules.tts`, cachea el buffer y
   * emite `tts:audio { url, audioId, mimeType }`. El cliente reproduce
   * y emite `tts:audio-ended`. Cuando NO se pasa (tests legacy), cae
   * al simulador que dispara `tts:audio-ended` tras un delay (mantiene
   * compatibilidad con tests existentes mientras se migra).
   */
  audioCache?: AudioCache;
  /**
   * Base URL absoluta del server HTTP que sirve `/audio/<id>.<ext>`
   * (típicamente `http://localhost:9876`). Solo se usa cuando hay
   * `audioCache`. Obligatorio en ese caso.
   */
  serverOrigin?: string;
}

const FALLBACK_RESPONSE = 'Algo salió mal procesando tu mensaje. ¿Lo intentas de nuevo?';
const MIN_SIMULATED_TTS_MS = 2_200;
const MS_PER_CHARACTER = 45;

const DEFAULT_MEMORY_READS: MemoryReadsConfig = {
  recentLimit: 5,
  semanticLimit: 3,
  timeoutMs: 1_500,
};

/**
 * Suscribe el handler de `user:message` que ejecuta el turno real.
 * Devuelve `unsubscribe` para limpieza en tests y shutdown.
 */
export function wireConversationFlow(options: WireConversationFlowOptions): () => void {
  const {
    bus,
    modules,
    systemPrompt,
    logger,
    simulationSpeed = 1,
    memoryReads = DEFAULT_MEMORY_READS,
    audioCache,
    serverOrigin,
  } = options;
  const child = logger.child({ module: 'ConversationFlow' });
  if (audioCache !== undefined && serverOrigin === undefined) {
    throw new Error(
      'wireConversationFlow: `audioCache` requiere también `serverOrigin` para construir las URLs de tts:audio.',
    );
  }
  // Suscripción al `tts:cancel` del cliente: invalida el audioId en el
  // cache para que cualquier fetch en vuelo desde otro cliente reciba 410.
  // Esta lista se usa para limpiar al disposer.
  const unsubscribers: (() => void)[] = [];

  // Gate de aprobación de tools `confirm` (ADR 0022 §4). Se crea una vez
  // (una sola suscripción al bus); cada turno que invoque una tool confirm
  // lo reutiliza. `dispose` limpia al shutdown.
  const approvalGate = createApprovalGate(bus, child);
  unsubscribers.push(() => {
    approvalGate.dispose();
  });

  if (audioCache !== undefined) {
    unsubscribers.push(
      bus.on('tts:cancel', (p) => {
        const removed = audioCache.invalidate(p.audioId);
        if (removed) child.debug(`tts:cancel invalidó ${p.audioId}`);
      }),
    );
  }

  const unsubscribe = bus.on('user:message', async (payload) => {
    const startTime = Date.now();

    // 0. Persistir el user msg al WAL — fire-and-forget. `local.save`
    //    dentro del MemoryManager es síncrono, así que SQLite ya tiene
    //    la entrada antes de continuar con el router; el push HTTP a
    //    Letta corre en paralelo con el resto del turno y, si falla,
    //    el drainer lo recupera. Esto le ahorra al usuario los ~100-300ms
    //    del push a Letta en el hot path.
    //
    //    El user msg NO se incluye en `getRecent` del turno actual de
    //    todas formas (el contexto es lo previo; el mensaje actual va
    //    como `request.text`), así que la carrera no introduce
    //    inconsistencias.
    void persistEntry(modules.memory, child, {
      id: randomUUID(),
      role: 'user',
      text: payload.text,
      timestamp: new Date(startTime).toISOString(),
      userId: payload.userId,
    });

    try {
      // 1. Router decide el tier.
      const tier = await modules.router.route({
        text: payload.text,
        userId: payload.userId,
      });
      await bus.emit('router:routed', { tier, userId: payload.userId });

      // 2. Lectura de memoria con timeout. Si tarda demasiado o devuelve
      //    vacío, procedemos sin contexto.
      const context = await fetchContext(
        modules.memory,
        payload.text,
        payload.userId,
        memoryReads,
        child,
      );

      // 3. LLM correspondiente responde. Si el tier es cloud y el slot cloud
      //    falla (típico: sin ANTHROPIC_API_KEY, rate limit o red), caemos a
      //    local en vez de romper el turno — el README promete este fallback.
      //    Si el local también falla, lo recoge el catch externo (fallback).
      const llmRequest = {
        text: payload.text,
        systemPrompt,
        userId: payload.userId,
        ...(context !== undefined ? { context } : {}),
      };
      let effectiveTier = tier;
      let response: LLMResponse;
      try {
        // Loop tool-use (ADR 0022 §5): solo en cloud, solo si el slot cloud
        // lo soporta y hay tools registradas. El gate de permisos vive en
        // `makeToolExecutor` (auto ejecuta; confirm pasa por el
        // `approvalGate` → modal del cliente). El local no recibe tools
        // (ADR §5).
        if (
          tier === 'cloud' &&
          typeof modules.llmCloud.generateWithTools === 'function' &&
          modules.tools.list().length > 0
        ) {
          response = await modules.llmCloud.generateWithTools(llmRequest, {
            tools: buildToolDefs(modules.tools),
            executeTool: makeToolExecutor(
              modules.tools,
              { logger: child, userId: payload.userId },
              child,
              approvalGate,
              // Persiste cada acción como turno `tool` (ADR 0022 §6).
              // Fire-and-forget vía el WAL, igual que user/assistant.
              (entry) => {
                void persistEntry(modules.memory, child, entry);
              },
            ),
          });
        } else {
          const llm = tier === 'local' ? modules.llmLocal : modules.llmCloud;
          response = await llm.generate(llmRequest);
        }
      } catch (err) {
        if (tier !== 'cloud') throw err;
        child.warn('LLM cloud falló — reintentando con local', { err });
        effectiveTier = 'local';
        response = await modules.llmLocal.generate(llmRequest);
      }

      // 4. Emite la respuesta tipada. `LLMResponse.emotion` es opcional;
      //    si la implementación no la rellena, default a neutral.
      const latencyMs = Date.now() - startTime;
      const emotion = response.emotion ?? 'neutral';
      await bus.emit('llm:responded', {
        text: response.text,
        emotion,
        userId: payload.userId,
        tier: effectiveTier,
        latencyMs,
      });
      child.debug(`turno completo en ${latencyMs}ms (tier=${effectiveTier})`);

      // 5. Persistir el assistant reply al WAL.
      await persistEntry(modules.memory, child, {
        id: randomUUID(),
        role: 'assistant',
        text: response.text,
        timestamp: new Date().toISOString(),
        userId: payload.userId,
        metadata: { emotion, tier: effectiveTier, latencyMs },
      });

      // 6. TTS: sintetiza, cachea, emite tts:audio (cliente reproduce y
      //    emitirá tts:audio-ended cuando termine). Si el cache no está
      //    configurado (tests legacy), cae al simulador.
      await dispatchTTS(
        bus,
        modules.tts,
        audioCache,
        serverOrigin,
        response.text,
        emotion,
        payload.userId,
        simulationSpeed,
        child,
      );
    } catch (err) {
      child.error('error procesando turno, emitiendo fallback', { err });
      const latencyMs = Date.now() - startTime;
      await bus.emit('llm:responded', {
        text: FALLBACK_RESPONSE,
        emotion: 'neutral',
        userId: payload.userId,
        tier: 'local',
        latencyMs,
      });
      await dispatchTTS(
        bus,
        modules.tts,
        audioCache,
        serverOrigin,
        FALLBACK_RESPONSE,
        'neutral',
        payload.userId,
        simulationSpeed,
        child,
      );
    }
  });

  return () => {
    unsubscribe();
    for (const u of unsubscribers) u();
  };
}

/**
 * Persiste una entrada con manejo defensivo de errores. El WAL del
 * MemoryManager garantiza que SQLite escribe síncrono — un fallo aquí
 * sería excepcional (disco lleno, schema corrupto). Loguea pero no
 * propaga: el turno sigue.
 */
async function persistEntry(
  memory: IMemoryModule,
  logger: Logger,
  entry: MemoryEntry,
): Promise<void> {
  try {
    await memory.save(entry);
  } catch (err) {
    logger.warn('memory.save falló — el turno continúa', { err, id: entry.id });
  }
}

/**
 * Recupera el contexto del LLM combinando `getRecent` (cronológico) y
 * `searchSemantic` (semántico, opcional). Cada lectura tiene su propio
 * timeout (`timeoutMs`): una lenta resuelve a `[]` sin tumbar a la otra,
 * así un `searchSemantic` frío no nos deja sin el `getRecent` barato.
 *
 * Devuelve `undefined` solo cuando **ambas** lecturas aportan 0 entradas
 * (por vacío, timeout individual o error — todo se degrada a `[]`).
 */
async function fetchContext(
  memory: IMemoryModule,
  query: string,
  userId: string,
  config: MemoryReadsConfig,
  logger: Logger,
): Promise<string | undefined> {
  // getRecent (cronológico, barato) y searchSemantic (requiere embeber la
  // query — puede ser lento por cold-start de embeddings) corren en paralelo
  // con timeout INDIVIDUAL: así un searchSemantic lento no arrastra al
  // getRecent. Cada lectura aporta lo que pueda dentro del deadline; si tarda
  // o falla, contribuye [] sin tumbar a la otra.
  const recentPromise: Promise<MemoryEntry[]> =
    config.recentLimit > 0
      ? withDeadline(memory.getRecent(userId, config.recentLimit), config.timeoutMs, () =>
          logger.warn(`memory.getRecent superó ${String(config.timeoutMs)}ms — sin recent`),
        )
      : Promise.resolve([]);

  const semanticPromise: Promise<MemoryEntry[]> =
    config.semanticLimit > 0 && typeof memory.searchSemantic === 'function'
      ? withDeadline(
          memory.searchSemantic(query, userId, config.semanticLimit),
          config.timeoutMs,
          () =>
            logger.warn(
              `memory.searchSemantic superó ${String(config.timeoutMs)}ms — sin semantic`,
            ),
        )
      : Promise.resolve([]);

  const [recent, semantic] = await Promise.all([recentPromise, semanticPromise]);
  if (recent.length === 0 && semantic.length === 0) return undefined;
  logger.info(
    `contexto recuperado: ${String(recent.length)} recientes + ${String(semantic.length)} semánticos`,
  );
  return formatContext(recent, semantic);
}

/**
 * Resuelve `p`, o `[]` si tarda más de `ms` o si rechaza. Nunca lanza — una
 * lectura lenta/fallida contribuye vacío sin bloquear a la otra. El timer se
 * limpia siempre (sin fugas en un server long-running).
 */
function withDeadline(
  p: Promise<MemoryEntry[]>,
  ms: number,
  onTimeout: () => void,
): Promise<MemoryEntry[]> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      resolve([]);
    }, ms);
    const finish = (value: MemoryEntry[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    p.then(finish, () => {
      finish([]);
    });
  });
}

/** Etiqueta legible del rol de un turno para el contexto del LLM. */
function roleLabel(role: MemoryEntry['role']): string {
  if (role === 'user') return 'Usuario';
  if (role === 'tool') return 'Acción de Shiro';
  return 'Shiro';
}

function formatContext(recent: readonly MemoryEntry[], semantic: readonly MemoryEntry[]): string {
  const lines: string[] = [];

  if (recent.length > 0) {
    lines.push('Conversación reciente:');
    for (const entry of recent) {
      lines.push(`- ${roleLabel(entry.role)}: ${entry.text}`);
    }
  }

  if (semantic.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Otros momentos relevantes de la conversación:');
    for (const entry of semantic) {
      lines.push(`- ${roleLabel(entry.role)}: ${entry.text}`);
    }
  }

  return lines.join('\n');
}

/**
 * Sintetiza el texto con el módulo TTS, cachea el buffer y emite
 * `tts:audio`. El cliente hará fetch a la URL y emitirá `tts:audio-ended`
 * cuando termine la reproducción. Si la cadena de TTS falla por
 * completo, o si el `audioCache`/`serverOrigin` no están configurados
 * (tests legacy), cae al simulador que emite `tts:audio-ended` con un
 * delay proporcional al texto — así el resto del estado del cliente
 * (Orbe que vuelve a idle, subtítulos) se desbloquea aunque no haya audio.
 */
async function dispatchTTS(
  bus: IEventBus<EventMap>,
  tts: ITTSModule,
  audioCache: AudioCache | undefined,
  serverOrigin: string | undefined,
  text: string,
  emotion: EventMap['llm:responded']['emotion'],
  userId: string,
  simulationSpeed: number,
  logger: Logger,
): Promise<void> {
  if (audioCache === undefined || serverOrigin === undefined) {
    // Camino legacy: simula `tts:audio-ended` tras un delay. Permite
    // que tests existentes que no inyectan audioCache sigan funcionando.
    simulateTTSEnd(bus, text, userId, simulationSpeed);
    return;
  }
  try {
    const { audio, mimeType } = await tts.synthesize({ text, emotion });
    const { audioId, relativeUrl } = audioCache.put(audio, mimeType);
    await bus.emit('tts:audio', {
      url: `${serverOrigin}${relativeUrl}`,
      audioId,
      mimeType,
      userId,
    });
  } catch (err) {
    // Toda la cadena TTS falló. El cliente nunca recibe `tts:audio` ni
    // tendrá audio para este turno — emitimos `tts:audio-ended` directo
    // para desbloquear el estado `speaking` en el reducer. El texto sí
    // se mostró ya por `llm:responded`, así que el usuario lee la
    // respuesta aunque no la escuche.
    logger.warn('TTS falló entero — emitiendo tts:audio-ended directo', { err });
    void bus.emit('tts:audio-ended', { userId });
  }
}

/**
 * Emite `tts:audio-ended` tras un delay proporcional al largo del texto.
 * Solo se usa en tests legacy sin `audioCache` configurado — en
 * producción siempre hay audioCache y el cliente emite `tts:audio-ended`
 * cuando termina la reproducción real.
 */
function simulateTTSEnd(
  bus: IEventBus<EventMap>,
  text: string,
  userId: string,
  speed: number,
): void {
  const baseMs = Math.max(MIN_SIMULATED_TTS_MS, text.length * MS_PER_CHARACTER);
  const delay = baseMs * speed;
  setTimeout(() => {
    void bus.emit('tts:audio-ended', { userId });
  }, delay);
}
