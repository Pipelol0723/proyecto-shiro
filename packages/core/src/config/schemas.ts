/**
 * Schemas zod para los archivos de configuración del runtime.
 *
 * Convenciones (ADR 0006):
 * - Schemas son la fuente única de verdad. Los tipos TS se infieren con
 *   `z.infer<typeof X>` — no se duplica la estructura a mano.
 * - El nivel "config" interno de cada slot queda como `Record<string, unknown>`
 *   porque cada módulo concreto validará su propia config con su propio
 *   schema (separación de responsabilidades).
 * - `version` es un literal numérico explícito — cuando cambiemos la
 *   forma del archivo, subimos el número y el loader puede emitir un
 *   error claro sobre versiones incompatibles.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// modules.config.yaml
// ─────────────────────────────────────────────────────────────────────

/**
 * Forma genérica de un "slot" de módulo: indica qué implementación está
 * activa, su config específica, y opcionalmente una cadena de fallbacks.
 *
 * Ejemplo (TTS):
 *   active: ElevenLabsTTS
 *   fallback_chain: [KokoroTTS, SystemTTS]
 *   config: { voice_id: '...', stability: 0.5 }
 */
const ModuleSlotSchema = z.object({
  active: z.string().min(1, 'el nombre del módulo activo no puede estar vacío'),
  fallback_chain: z.array(z.string().min(1)).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * El LLM tiene dos sub-slots (local y cloud) porque el HybridRouter
 * decide cuál usar para cada mensaje. No es un slot único.
 */
const LLMSlotSchema = z.object({
  local: ModuleSlotSchema,
  cloud: ModuleSlotSchema,
});

const CharacterRefSchema = z.object({
  file: z.string().min(1, 'la ruta al archivo del personaje no puede estar vacía'),
});

export const ModulesConfigSchema = z.object({
  version: z.literal(1),
  modules: z.object({
    llm: LLMSlotSchema,
    router: ModuleSlotSchema,
    stt: ModuleSlotSchema,
    tts: ModuleSlotSchema,
    memory: ModuleSlotSchema,
    avatar: ModuleSlotSchema,
  }),
  character: CharacterRefSchema,
});

export type ModuleSlot = z.infer<typeof ModuleSlotSchema>;
export type LLMSlot = z.infer<typeof LLMSlotSchema>;
export type ModulesConfig = z.infer<typeof ModulesConfigSchema>;

// ─────────────────────────────────────────────────────────────────────
// devices.config.yaml
// ─────────────────────────────────────────────────────────────────────

/**
 * Schema permisivo a propósito. Los dispositivos reales llegan en
 * Fase 11 o antes (Arduino) — cuando sepamos la forma concreta de
 * cada tipo, narrowing del schema con z.discriminatedUnion.
 *
 * Por ahora cualquier objeto con un `id` string y un `type` string vale.
 */
const DeviceSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
  })
  .catchall(z.unknown());

export const DevicesConfigSchema = z.object({
  version: z.literal(1),
  devices: z.array(DeviceSchema),
});

export type Device = z.infer<typeof DeviceSchema>;
export type DevicesConfig = z.infer<typeof DevicesConfigSchema>;
