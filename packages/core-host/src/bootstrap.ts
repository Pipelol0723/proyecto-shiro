/**
 * Bootstrap del core-host — pega las piezas para arrancar el Orchestrator
 * server-side. Reutilizable desde `server.ts` (producción) y desde tests
 * de integración.
 *
 * Flujo:
 *   1. Logger raíz.
 *   2. WebSocketServerTransport (escucha en `port`/`path`).
 *   3. EventBus inyectando el transport.
 *   4. ModuleLoader con factories registradas (mocks por ahora — ver
 *      `mocks/noop-modules.ts`).
 *   5. Orchestrator.init() instancia los 7 módulos.
 *   6. `wireMockConversationFlow` engancha la simulación al bus para que
 *      `user:message` produzca el ciclo completo. Se reemplazará por el
 *      pipeline real en PR 7.
 *   7. `buildSystemPrompt(character)` produce el string que el wiring de
 *      PR 7 inyectará como `systemPrompt` en cada `LLMRequest`.
 *
 * El `config` y el `character` se reciben ya parseados (responsabilidad
 * del caller: `server.ts` lee del disco; los tests pasan fixtures).
 *
 * Ver ADR 0012 (split cliente/server) y ADR 0001 (modular event-driven).
 */

import {
  AnthropicLLM,
  buildSystemPrompt,
  EventBus,
  HybridRouter,
  Logger,
  ModuleLoader,
  OllamaLLM,
  Orchestrator,
  WhisperSTT,
  type Character,
  type EventMap,
  type IEventBus,
  type ModulesConfig,
} from '@proyecto-shiro/core';
import { MemoryManager } from '@proyecto-shiro/core/node';
import { WebSocketServerTransport } from './transports/websocket-server-transport.js';
import { wireConversationFlow } from './pipeline/conversation-flow.js';
import { NoopAvatar, NoopTTS } from './mocks/noop-modules.js';

export interface BootstrapOptions {
  /** Puerto WS. `0` para que el SO asigne uno (útil en tests). */
  port: number;
  /** Path del endpoint WS. Default `/bus`. */
  path?: string;
  /** Config validada (ya pasada por `ConfigLoader.loadModulesConfig`). */
  config: ModulesConfig;
  /**
   * Personaje activo. Ya parseado por `CharacterLoader.loadFromFile`.
   * El caller (server.ts) hace el I/O; tests pasan un fixture inline.
   */
  character: Character;
  /** Logger ya construido. Si se omite, se crea uno con LOG_LEVEL del entorno. */
  logger?: Logger;
  /** Acelera/relentece el simulador. Default 1 (humano). 0 = inmediato. */
  simulationSpeed?: number;
}

export interface BootstrapResult {
  bus: IEventBus<EventMap>;
  orchestrator: Orchestrator;
  transport: WebSocketServerTransport;
  logger: Logger;
  /** Personaje cargado. Inmutable durante el lifetime del server. */
  character: Character;
  /** System prompt pre-construido — se reutiliza turn a turn sin recomputar. */
  systemPrompt: string;
  /** Cierra todo limpiamente — útil para tests y para SIGINT en server. */
  shutdown: () => Promise<void>;
}

/**
 * Construye e inicializa el core-host. Devuelve handles para que el
 * llamador pueda inspeccionar / apagar.
 *
 * Llama a esto desde `server.ts` (entry point real) o desde tests. La
 * `Promise` resuelve cuando el server está escuchando y el Orchestrator
 * ha emitido `bus:ready`.
 */
export async function bootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const logger = options.logger ?? new Logger();
  const child = logger.child({ module: 'bootstrap' });

  // 1. Transport server-side (espera a que esté listening).
  const transport = new WebSocketServerTransport({
    port: options.port,
    path: options.path,
    logger,
  });
  await transport.ready();

  // 2. EventBus inyectando el transport.
  const bus = new EventBus<EventMap>({
    logger,
    transports: [transport],
  });

  // 3. ModuleLoader con factories. LLM local/cloud y Router son ya las
  //    implementaciones reales (PRs 5, 6, 7). STT/TTS/Memory/Avatar
  //    siguen siendo mocks no-op hasta sus respectivos hitos.
  const loader = new ModuleLoader({ logger });
  loader.register('OllamaLLM', (cfg, deps) => new OllamaLLM(cfg, deps));
  loader.register('AnthropicLLM', (cfg, deps) => new AnthropicLLM(cfg, deps));
  loader.register('HybridRouter', (cfg, deps) => new HybridRouter(cfg, deps));
  loader.register('WhisperSTT', (cfg, deps) => new WhisperSTT(cfg, deps));
  loader.register('ElevenLabsTTS', () => new NoopTTS());
  loader.register('MemoryManager', (cfg, deps) => new MemoryManager(cfg, deps));
  loader.register('Live2DAvatar', () => new NoopAvatar());

  // 4. Orchestrator: instancia los 7 módulos y emite `bus:ready`.
  const orchestrator = new Orchestrator({ bus, loader, logger, config: options.config });
  await orchestrator.init();

  // 4b. MemoryManager necesita lifecycle propio (drainer en background +
  //     SQLite). El factory devuelve IMemoryModule pero sabemos por el
  //     YAML que es un MemoryManager. Cast justificado: el bootstrap es
  //     quien controla el wiring; si en el futuro se permite swappear
  //     el slot memory por algo sin start/stop, este cast hay que revisarlo.
  const memoryManager = orchestrator.getModules().memory as MemoryManager;
  await memoryManager.start();

  // 4b'. WhisperSTT: healthcheck no bloqueante. Si el microservicio Python
  //      no responde (no arrancado, otro puerto, modelo aún cargando), el
  //      core-host sigue funcionando — STT solo afecta al input por voz.
  //      Si está activo el módulo real (no un mock), pingamos en background.
  const sttModule = orchestrator.getModules().stt;
  if (sttModule instanceof WhisperSTT) {
    const whisperStt = sttModule;
    void (async (): Promise<void> => {
      const ok = await whisperStt.ping();
      if (ok) {
        child.info(`WhisperSTT: microservicio reachable en ${whisperStt.serviceUrl}`);
      } else {
        child.warn(
          `WhisperSTT: microservicio NO responde en ${whisperStt.serviceUrl} — el chat por voz no estará disponible. ` +
            `Levanta el contenedor con: docker compose up -d whisper`,
        );
      }
    })();
  }

  const memoryReads = memoryManager.getPipelineConfig();
  const userId = options.config.modules.memory.config?.user_id;
  const snapshotUserId = typeof userId === 'string' && userId.length > 0 ? userId : 'default';

  // 4c. Snapshot del historial al conectar — cuando un cliente nuevo entra,
  //     pedimos los últimos N turnos a Letta y los empujamos vía `memory:snapshot`.
  //     El cliente decide aplicarlos solo si su historial está vacío
  //     (idempotencia en el reducer). Ver ADR 0017 sección "Sync con cliente".
  transport.onConnection(() => {
    void (async (): Promise<void> => {
      try {
        const entries = await memoryManager.getRecent(snapshotUserId, memoryReads.snapshotLimit);
        if (entries.length === 0) return; // sin historial, nada que hidratar
        await bus.emit('memory:snapshot', { entries, userId: snapshotUserId });
      } catch (err) {
        child.warn('memory:snapshot al conectar falló', { err });
      }
    })();
  });

  // 5. System prompt pre-construido — se reusa turn a turn.
  const systemPrompt = buildSystemPrompt(options.character);

  // 6. Cablea el pipeline conversacional real. `user:message` arranca
  //    el flujo router → LLM → llm:responded → tts:audio-ended (este
  //    último simulado hasta el hito TTS). Ver ADR 0016.
  const disposeFlow = wireConversationFlow({
    bus,
    modules: orchestrator.getModules(),
    systemPrompt,
    logger,
    simulationSpeed: options.simulationSpeed,
    memoryReads,
  });

  child.info(
    `core-host listo en puerto ${transport.port}${options.path ?? '/bus'} (personaje: ${options.character.identity.name})`,
  );

  return {
    bus,
    orchestrator,
    transport,
    logger,
    character: options.character,
    systemPrompt,
    shutdown: async () => {
      disposeFlow();
      await memoryManager.stop();
      await orchestrator.shutdown();
      await transport.close();
      child.info('core-host apagado');
    },
  };
}
