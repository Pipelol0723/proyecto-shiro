/**
 * Re-exports browser-safe del subsistema de config.
 *
 * Solo schemas + tipos. El `ConfigLoader` (que usa `node:fs`) vive en
 * `@proyecto-shiro/core/node` y se exporta desde `src/node.ts`.
 *
 * Ver ADR 0011.
 */

export type { Device, DevicesConfig, LLMSlot, ModuleSlot, ModulesConfig } from './schemas.js';
export { DevicesConfigSchema, ModulesConfigSchema } from './schemas.js';
