/**
 * Schema zod del archivo de personaje (`src/character/characters/*.yaml`).
 *
 * Browser-safe: solo `zod`. El loader que lee del disco vive en
 * `character-loader.ts` (Node-only, exportado desde `core/node`).
 *
 * Convención:
 * - Los campos **obligatorios** son los que el `buildSystemPrompt`
 *   necesita para generar un prompt útil (identidad, personalidad).
 * - Los campos **opcionales** enriquecen el prompt si están, pero no
 *   son esenciales — un personaje puede definirse mínimamente.
 * - `emotions` lo lee el módulo TTS y el AvatarModule, no el LLM.
 */

import { z } from 'zod';

const IdentitySchema = z.object({
  name: z.string().min(1, 'el nombre del personaje no puede estar vacío'),
  pronouns: z.string().min(1),
  age_apparent: z.string().optional(),
  origin: z.string().optional(),
});

const PersonalitySchema = z.object({
  traits: z.array(z.string().min(1)).min(1, 'debe haber al menos un rasgo'),
  speech_style: z.string().min(1),
  likes: z.array(z.string()).optional(),
  dislikes: z.array(z.string()).optional(),
});

const BehaviorsSchema = z
  .object({
    greeting_style: z.string().optional(),
    uncertainty_style: z.string().optional(),
    /**
     * Mapeo de registro emocional → instrucción de tono. p.ej.
     * `{ casual: 'relajado, con humor ligero', serio: '...' }`.
     */
    emotional_register: z.record(z.string(), z.string()).optional(),
  })
  .optional();

const EmotionMappingSchema = z.record(
  z.string(),
  z.object({
    tts_stability: z.number().min(0).max(1).optional(),
    avatar_expression: z.string().optional(),
  }),
);

export const CharacterSchema = z.object({
  version: z.literal(1),
  identity: IdentitySchema,
  personality: PersonalitySchema,
  backstory: z.string().optional(),
  behaviors: BehaviorsSchema,
  /**
   * Reglas de comportamiento conversacional. Se inyectan tal cual como
   * sección "REGLAS" del system prompt — el LLM debe respetarlas en
   * cada turno. Útil para anti-patterns ("no halagar", "evitar emojis").
   */
  interaction_rules: z.array(z.string().min(1)).optional(),
  emotions: EmotionMappingSchema.optional(),
});

export type Character = z.infer<typeof CharacterSchema>;
