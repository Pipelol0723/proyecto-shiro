import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CharacterLoader } from '../../../src/character/character-loader.js';
import { CharacterSchema } from '../../../src/character/schema.js';
import { Logger } from '../../../src/core/logger.js';
import { EMOTIONS } from '../../../src/types/emotions.js';

const DEFAULT_CHARACTER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/character/characters/default.yaml',
);

const MINIMAL_CHARACTER = {
  version: 1,
  identity: {
    name: 'Test',
    pronouns: 'elle',
  },
  personality: {
    traits: ['curiosa'],
    speech_style: 'directa',
  },
} as const;

describe('CharacterSchema', () => {
  it('valida un personaje mínimo', () => {
    const result = CharacterSchema.safeParse(MINIMAL_CHARACTER);
    expect(result.success).toBe(true);
  });

  it('rechaza version distinta de 1', () => {
    const result = CharacterSchema.safeParse({ ...MINIMAL_CHARACTER, version: 2 });
    expect(result.success).toBe(false);
  });

  it('rechaza nombre vacío', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      identity: { ...MINIMAL_CHARACTER.identity, name: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rechaza traits vacíos', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      personality: { ...MINIMAL_CHARACTER.personality, traits: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rechaza speech_style vacío', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      personality: { ...MINIMAL_CHARACTER.personality, speech_style: '' },
    });
    expect(result.success).toBe(false);
  });

  it('acepta personaje completo con backstory y behaviors', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      backstory: 'Era un companion personal.',
      behaviors: {
        greeting_style: 'casual',
        uncertainty_style: 'directo',
        emotional_register: {
          casual: 'relajado',
          serio: 'atento',
        },
      },
      emotions: {
        neutral: { tts_stability: 0.5, avatar_expression: 'idle' },
        divertida: { tts_stability: 0.4 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rechaza tts_stability fuera de [0, 1]', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      emotions: { neutral: { tts_stability: 1.5 } },
    });
    expect(result.success).toBe(false);
  });

  // `safeParse` descarta en silencio los campos desconocidos y devuelve success,
  // así que estos tests aseveran sobre el dato parseado, no sobre `success`.
  it('conserva tts_style en result.data.emotions.<emoción>.tts_style', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      emotions: { neutral: { tts_style: 'calm and quiet' } },
    });
    expect(result.success).toBe(true);
    expect(result.data?.emotions?.neutral?.tts_style).toBe('calm and quiet');
  });

  it('rechaza tts_style vacío', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      emotions: { neutral: { tts_style: '' } },
    });
    expect(result.success).toBe(false);
  });

  it('rechaza tts_style que no sea string', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      emotions: { neutral: { tts_style: 42 } },
    });
    expect(result.success).toBe(false);
  });

  it('default.yaml: las cinco emociones tienen tts_style', () => {
    const loader = new CharacterLoader({ logger: new Logger('error') });
    const character = loader.loadFromFile(DEFAULT_CHARACTER_PATH);
    expect(EMOTIONS).toHaveLength(5);
    for (const emotion of EMOTIONS) {
      const style = character.emotions?.[emotion]?.tts_style;
      expect(typeof style, `falta tts_style en ${emotion}`).toBe('string');
      expect(style?.length).toBeGreaterThan(0);
    }
  });

  it('acepta interaction_rules como array de strings', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      interaction_rules: ['evita emojis', 'no halaga al usuario'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interaction_rules).toEqual(['evita emojis', 'no halaga al usuario']);
    }
  });

  it('rechaza interaction_rules con elementos vacíos', () => {
    const result = CharacterSchema.safeParse({
      ...MINIMAL_CHARACTER,
      interaction_rules: ['regla válida', ''],
    });
    expect(result.success).toBe(false);
  });

  it('omite interaction_rules si no se pasa (opcional)', () => {
    const result = CharacterSchema.safeParse(MINIMAL_CHARACTER);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interaction_rules).toBeUndefined();
    }
  });
});
