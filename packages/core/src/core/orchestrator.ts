/**
 * Orchestrator — coordinador central del companion.
 *
 * Patrón: Mediator + Lifecycle facade.
 *
 * Responsabilidades en Fase 1B:
 * 1. Instanciar todos los módulos del config via `ModuleLoader`.
 * 2. Exponer los módulos para que el cliente (desktop, mobile, tests)
 *    pueda interactuar con ellos.
 * 3. Emitir `bus:ready` cuando el sistema está listo.
 * 4. Permitir un `shutdown()` ordenado.
 *
 * Lo que NO hace todavía (llega en Fase 2+):
 * - Cadenas de fallback (`fallback_chain` del YAML).
 * - Wiring de eventos automatizado entre módulos.
 * - Health checks, métricas, reconexiones.
 *
 * Ver ADR 0001, 0006, 0007.
 */

import type { IAvatarModule } from '../interfaces/IAvatarModule.js';
import type { IEventBus } from '../interfaces/IEventBus.js';
import type { ILLMModule } from '../interfaces/ILLMModule.js';
import type { IMemoryModule } from '../interfaces/IMemoryModule.js';
import type { IRouterModule } from '../interfaces/IRouterModule.js';
import type { ISTTModule } from '../interfaces/ISTTModule.js';
import type { ITTSModule } from '../interfaces/ITTSModule.js';
import type { ModulesConfig } from '../config/schemas.js';
import type { Logger } from './logger.js';
import type { ModuleDeps, ModuleLoader } from './module-loader.js';

export interface LoadedModules {
  llmLocal: ILLMModule;
  llmCloud: ILLMModule;
  router: IRouterModule;
  stt: ISTTModule;
  tts: ITTSModule;
  memory: IMemoryModule;
  avatar: IAvatarModule;
}

export interface OrchestratorOptions {
  bus: IEventBus;
  loader: ModuleLoader;
  logger: Logger;
  config: ModulesConfig;
}

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export class Orchestrator {
  private readonly bus: IEventBus;
  private readonly loader: ModuleLoader;
  private readonly logger: Logger;
  private readonly config: ModulesConfig;
  private modules: LoadedModules | null = null;
  private started = false;

  constructor(options: OrchestratorOptions) {
    this.bus = options.bus;
    this.loader = options.loader;
    this.logger = options.logger.child({ module: 'Orchestrator' });
    this.config = options.config;
  }

  /**
   * Instancia todos los módulos definidos como `active` en el config
   * y emite `bus:ready`. Si una factory falla, propaga el error sin
   * continuar (fail-fast en arranque).
   *
   * Idempotente: llamar dos veces sin shutdown intermedio lanza error.
   */
  async init(): Promise<void> {
    if (this.started) {
      throw new OrchestratorError('Orchestrator ya está iniciado. Llama a shutdown() primero.');
    }

    this.logger.info('inicializando módulos del core');
    const deps: ModuleDeps = { logger: this.logger, bus: this.bus };
    const m = this.config.modules;

    this.modules = {
      llmLocal: this.loader.load<ILLMModule>(m.llm.local.active, m.llm.local.config, deps),
      llmCloud: this.loader.load<ILLMModule>(m.llm.cloud.active, m.llm.cloud.config, deps),
      router: this.loader.load<IRouterModule>(m.router.active, m.router.config, deps),
      stt: this.loader.load<ISTTModule>(m.stt.active, m.stt.config, deps),
      tts: this.loader.load<ITTSModule>(m.tts.active, m.tts.config, deps),
      memory: this.loader.load<IMemoryModule>(m.memory.active, m.memory.config, deps),
      avatar: this.loader.load<IAvatarModule>(m.avatar.active, m.avatar.config, deps),
    };

    this.started = true;
    this.logger.info('módulos cargados, emitiendo bus:ready');

    await this.bus.emit('bus:ready', { startedAt: new Date().toISOString() });
  }

  /**
   * Apaga el sistema: limpia subscripciones del bus y descarta los
   * módulos. Implementaciones de módulos que tengan recursos abiertos
   * (DB, sockets) deberán exponer su propio close() — TBD en Fase 2.
   */
  shutdown(): Promise<void> {
    if (!this.started) {
      this.logger.warn('shutdown() llamado sin init() previo, no-op');
      return Promise.resolve();
    }
    this.logger.info('apagando Orchestrator');
    this.bus.clear();
    this.modules = null;
    this.started = false;
    return Promise.resolve();
  }

  /**
   * Devuelve los módulos cargados. Solo válido entre `init()` y `shutdown()`.
   * Útil para clientes (desktop, mobile, tests) que quieran invocar
   * métodos de un módulo concreto.
   */
  getModules(): LoadedModules {
    if (!this.modules) {
      throw new OrchestratorError('init() no se ha llamado todavía.');
    }
    return this.modules;
  }

  /** True si init() se ha llamado y shutdown() aún no. */
  isStarted(): boolean {
    return this.started;
  }
}
