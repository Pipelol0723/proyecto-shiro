/**
 * Re-exports browser-safe del módulo de personaje. El `CharacterLoader`
 * (que usa `node:fs`) vive aparte en `character-loader.ts` y se exporta
 * desde `@proyecto-shiro/core/node`.
 */

export { CharacterSchema, type Character } from './schema.js';
export { buildSystemPrompt } from './system-prompt-builder.js';
