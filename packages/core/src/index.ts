/**
 * `@proyecto-shiro/core` — API pública browser-safe del cerebro.
 *
 * Cliente típico (cliente desktop con Vite, futuro mobile, etc.):
 *
 *   import {
 *     EventBus, InProcessTransport, Logger,
 *     ModuleLoader, Orchestrator,
 *   } from '@proyecto-shiro/core';
 *   import type { Emotion, EventMap, IEventBus } from '@proyecto-shiro/core';
 *
 * Para utilidades que **dependen de Node** (lectura de YAML del disco
 * vía `ConfigLoader`), importar de `@proyecto-shiro/core/node`. Ese
 * entry NO se puede meter en un bundle browser.
 *
 * Ver ADR 0011.
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

export { WebSocketTransport } from './core/transports/websocket-transport.js';
export type {
  WebSocketTransportOptions,
  WebSocketLike,
  WebSocketCtor,
  Scheduler,
} from './core/transports/websocket-transport.js';

export {
  WIRE_PROTOCOL_VERSION,
  WireEnvelopeSchema,
  makeEnvelope,
  serializeEnvelope,
  parseEnvelope,
} from './core/transports/wire-schema.js';
export type { WireEnvelope, ParseResult } from './core/transports/wire-schema.js';

// Loader y Orchestrator (puros — no usan node:fs)
export { ModuleLoader, ModuleLoaderError } from './core/module-loader.js';
export type { ModuleDeps, ModuleFactory } from './core/module-loader.js';

export { Orchestrator, OrchestratorError } from './core/orchestrator.js';
export type { LoadedModules, OrchestratorOptions } from './core/orchestrator.js';

// Schemas + tipos de config (browser-safe). El ConfigLoader vive en
// `@proyecto-shiro/core/node`.
export * from './config/index.js';

// Schemas + builder del personaje (browser-safe). El CharacterLoader
// vive en `@proyecto-shiro/core/node`.
export * from './character/index.js';

// Implementaciones de módulos LLM (browser-safe — usan fetch).
export { OllamaLLM, OllamaLLMConfigSchema, OllamaLLMError } from './modules/llm/ollama-llm.js';
export type { OllamaLLMConfig } from './modules/llm/ollama-llm.js';

export {
  AnthropicLLM,
  AnthropicLLMConfigSchema,
  AnthropicLLMError,
} from './modules/llm/anthropic-llm.js';
export type { AnthropicLLMConfig, AnthropicLLMOptions } from './modules/llm/anthropic-llm.js';

export {
  HybridRouter,
  HybridRouterConfigSchema,
  HybridRouterError,
  routeByHeuristic,
} from './modules/router/hybrid-router.js';
export type { HybridRouterConfig } from './modules/router/hybrid-router.js';

// Memoria — LettaMemory es browser-safe (usa fetch). LocalMemory (SQLite,
// nativo) vive en `@proyecto-shiro/core/node`.
export {
  LettaMemory,
  LettaMemoryConfigSchema,
  LettaMemoryError,
} from './modules/memory/letta-memory.js';
export type { LettaMemoryConfig } from './modules/memory/letta-memory.js';
