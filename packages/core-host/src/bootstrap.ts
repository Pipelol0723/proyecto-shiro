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
 *
 * El `config` se recibe ya parseado (responsabilidad del caller: `server.ts`
 * lo lee del disco con `ConfigLoader`; los tests pasan un fixture).
 *
 * Ver ADR 0012 (split cliente/server) y ADR 0001 (modular event-driven).
 */

import {
  EventBus,
  Logger,
  ModuleLoader,
  Orchestrator,
  type EventMap,
  type IEventBus,
  type ModulesConfig,
} from '@proyecto-shiro/core';
import { WebSocketServerTransport } from './transports/websocket-server-transport.js';
import { wireMockConversationFlow } from './mocks/mock-conversation-flow.js';
import {
  NoopAvatar,
  NoopLLM,
  NoopMemory,
  NoopRouter,
  NoopSTT,
  NoopTTS,
} from './mocks/noop-modules.js';

export interface BootstrapOptions {
  /** Puerto WS. `0` para que el SO asigne uno (útil en tests). */
  port: number;
  /** Path del endpoint WS. Default `/bus`. */
  path?: string;
  /** Config validada (ya pasada por `ConfigLoader.loadModulesConfig`). */
  config: ModulesConfig;
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

  // 3. ModuleLoader con factories de los mocks (PR 3 — se reemplazan
  //    progresivamente en PRs 5/6/7 y hitos posteriores).
  const loader = new ModuleLoader({ logger });
  loader.register('OllamaLLM', () => new NoopLLM('llm:noop-local'));
  loader.register('AnthropicLLM', () => new NoopLLM('llm:noop-cloud'));
  loader.register('HybridRouter', () => new NoopRouter());
  loader.register('WhisperSTT', () => new NoopSTT());
  loader.register('ElevenLabsTTS', () => new NoopTTS());
  loader.register('LettaMemory', () => new NoopMemory());
  loader.register('Live2DAvatar', () => new NoopAvatar());

  // 4. Orchestrator: instancia los 7 módulos y emite `bus:ready`.
  const orchestrator = new Orchestrator({ bus, loader, logger, config: options.config });
  await orchestrator.init();

  // 5. Engancha el simulador del flujo conversacional. Cuando el cliente
  //    emita `user:message`, el simulador responde con la cadena de
  //    eventos. Se reemplaza por el pipeline real en PR 7.
  const disposeSimulator = wireMockConversationFlow({
    bus,
    speed: options.simulationSpeed,
  });

  child.info(`core-host listo en puerto ${transport.port}${options.path ?? '/bus'}`);

  return {
    bus,
    orchestrator,
    transport,
    logger,
    shutdown: async () => {
      disposeSimulator();
      await orchestrator.shutdown();
      await transport.close();
      child.info('core-host apagado');
    },
  };
}
