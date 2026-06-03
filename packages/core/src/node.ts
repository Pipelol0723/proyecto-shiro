/**
 * `@proyecto-shiro/core/node` — entry point con utilidades que dependen
 * de APIs Node (file system, process, etc.).
 *
 * Importar solo desde código que **garantiza correr en Node**:
 * scripts CLI, tests, backend de Electron/Tauri, microservicios.
 *
 * El cliente browser (Vite, Tauri renderer) NO debe importar de aquí —
 * Vite incluiría `node:fs` en el bundle y rompería el build.
 *
 * Ver ADR 0011 (split del core en entries browser-safe vs Node-only).
 */

export { ConfigLoader, ConfigValidationError } from './config/config-loader.js';

export { CharacterLoader, CharacterValidationError } from './character/character-loader.js';

// Módulos con dependencias nativas / SDKs server-side — solo Node.
export { LocalMemory } from './modules/memory/local-memory.js';
export type { LocalMemoryOptions } from './modules/memory/local-memory.js';

// LettaMemory usa el SDK de Letta (`@letta-ai/letta-client`) — server-side,
// fuera del bundle browser. Ver ADR 0018.
export {
  LettaMemory,
  LettaMemoryConfigSchema,
  LettaMemoryError,
} from './modules/memory/letta-memory.js';
export type { LettaMemoryConfig, LettaClientLike } from './modules/memory/letta-memory.js';

export {
  MemoryManager,
  MemoryManagerConfigSchema,
  MemoryManagerError,
} from './modules/memory/memory-manager.js';
export type {
  MemoryManagerConfig,
  MemoryManagerBackends,
} from './modules/memory/memory-manager.js';

// SystemTTS — wrapper de `say.js` para usar la voz nativa del OS como
// fallback cuando ElevenLabs cae (ADR 0020). Usa child_process + FS
// para exportar a WAV; estrictamente Node-only.
export { SystemTTS, SystemTTSConfigSchema, SystemTTSError } from './modules/tts/system-tts.js';
export type { SystemTTSConfig, SystemTTSDeps } from './modules/tts/system-tts.js';
