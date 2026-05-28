import { describe, expect, it } from 'vitest';
import { CharacterSchema } from '../../../src/character/schema.js';

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
        alegre: { tts_stability: 0.4 },
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
});
