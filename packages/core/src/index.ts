/**
 * @proyecto-shiro/core — API pública del cerebro.
 *
 * Cliente típico (futuro `@proyecto-shiro/desktop`, `@proyecto-shiro/mobile`):
 *
 *   import {
 *     ConfigLoader, ModuleLoader, Orchestrator,
 *     EventBus, InProcessTransport, Logger,
 *   } from '@proyecto-shiro/core';
 *
 * Las interfaces se exportan como tipos puros (`export type`) para que
 * el cliente pueda implementar módulos propios sin importar runtime extra.
 */

export const VERSION = '0.1.0';

// Tipos del dominio (emociones, eventos)
export * from './types/index.js';

// Contratos (interfaces de módulos y EventBus/Transport)
export * from './interfaces/index.js';

// Primitivas del core
export { Logger } from './core/logger.js';
export type { LogLevel, LogContext } from './core/logger.js';

export { EventBus } from './core/event-bus.js';
export type { EventBusOptions } from './core/event-bus.js';

export { InProcessTransport } from './core/transports/in-process-transport.js';

// Loader y Orchestrator
export { ModuleLoader, ModuleLoaderError } from './core/module-loader.js';
export type { ModuleDeps, ModuleFactory } from './core/module-loader.js';

export { Orchestrator, OrchestratorError } from './core/orchestrator.js';
export type { LoadedModules, OrchestratorOptions } from './core/orchestrator.js';

// Config (schemas + loader)
export * from './config/index.js';
