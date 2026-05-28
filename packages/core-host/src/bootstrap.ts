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
  type Character,
  type EventMap,
  type IEventBus,
  type ModulesConfig,
} from '@proyecto-shiro/core';
import { WebSocketServerTransport } from './transports/websocket-server-transport.js';
import { wireConversationFlow } from './pipeline/conversation-flow.js';
import { NoopAvatar, NoopMemory, NoopSTT, NoopTTS } from './mocks/noop-modules.js';

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
  loader.register('WhisperSTT', () => new NoopSTT());
  loader.register('ElevenLabsTTS', () => new NoopTTS());
  loader.register('LettaMemory', () => new NoopMemory());
  loader.register('Live2DAvatar', () => new NoopAvatar());

  // 4. Orchestrator: instancia los 7 módulos y emite `bus:ready`.
  const orchestrator = new Orchestrator({ bus, loader, logger, config: options.config });
  await orchestrator.init();

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
      await orchestrator.shutdown();
      await transport.close();
      child.info('core-host apagado');
    },
  };
}
