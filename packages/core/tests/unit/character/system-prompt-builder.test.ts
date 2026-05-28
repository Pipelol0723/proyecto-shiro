import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../../src/character/system-prompt-builder.js';
import type { Character } from '../../../src/character/schema.js';

const MINIMAL: Character = {
  version: 1,
  identity: {
    name: 'Shiro',
    pronouns: 'ella',
  },
  personality: {
    traits: ['curiosa', 'directa'],
    speech_style: 'natural, frases cortas',
  },
};

describe('buildSystemPrompt', () => {
  it('produce una cabecera con el nombre del personaje', () => {
    const prompt = buildSystemPrompt(MINIMAL);
    expect(prompt).toMatch(/Eres Shiro/);
    expect(prompt).toMatch(/AI companion personal/);
  });

  it('incluye pronombres, rasgos y estilo siempre', () => {
    const prompt = buildSystemPrompt(MINIMAL);
    expect(prompt).toMatch(/Pronombres: ella/);
    expect(prompt).toMatch(/Rasgos: curiosa, directa/);
    expect(prompt).toMatch(/Estilo al hablar: natural, frases cortas/);
  });

  it('omite age_apparent si no está', () => {
    const prompt = buildSystemPrompt(MINIMAL);
    expect(prompt).not.toMatch(/Edad aparente/);
  });

  it('incluye edad aparente cuando está presente', () => {
    const prompt = buildSystemPrompt({
      ...MINIMAL,
      identity: { ...MINIMAL.identity, age_apparent: '~20' },
    });
    expect(prompt).toMatch(/Edad aparente: ~20/);
  });

  it('incluye likes y dislikes cuando están', () => {
    const prompt = buildSystemPrompt({
      ...MINIMAL,
      personality: {
        ...MINIMAL.personality,
        likes: ['café', 'música electrónica'],
        dislikes: ['formalismos'],
      },
    });
    expect(prompt).toMatch(/Te gusta: café, música electrónica/);
    expect(prompt).toMatch(/Evitas: formalismos/);
  });

  it('omite la sección de likes/dislikes si están vacíos', () => {
    const prompt = buildSystemPrompt({
      ...MINIMAL,
      personality: { ...MINIMAL.personality, likes: [], dislikes: [] },
    });
    expect(prompt).not.toMatch(/Te gusta:/);
    expect(prompt).not.toMatch(/Evitas:/);
  });

  it('incluye CONTEXTO cuando hay backstory', () => {
    const prompt = buildSystemPrompt({
      ...MINIMAL,
      backstory: 'Companion personal con opiniones propias.',
    });
    expect(prompt).toMatch(/CONTEXTO/);
    expect(prompt).toMatch(/Companion personal con opiniones propias\./);
  });

  it('omite CONTEXTO si backstory es solo whitespace', () => {
    const prompt = buildSystemPrompt({ ...MINIMAL, backstory: '   \n   ' });
    expect(prompt).not.toMatch(/CONTEXTO/);
  });

  it('incluye comportamientos cuando están presentes', () => {
    const prompt = buildSystemPrompt({
      ...MINIMAL,
      behaviors: {
        greeting_style: 'casual',
        uncertainty_style: 'lo admite sin rodeos',
        emotional_register: {
          casual: 'relajado',
          serio: 'atento',
        },
      },
    });
    expect(prompt).toMatch(/COMPORTAMIENTO/);
    expect(prompt).toMatch(/Al saludar: casual/);
    expect(prompt).toMatch(/Cuando no sabes algo: lo admite sin rodeos/);
    expect(prompt).toMatch(/casual: relajado/);
    expect(prompt).toMatch(/serio: atento/);
  });

  it('omite COMPORTAMIENTO si behaviors está vacío de campos útiles', () => {
    const prompt = buildSystemPrompt({ ...MINIMAL, behaviors: {} });
    expect(prompt).not.toMatch(/COMPORTAMIENTO/);
  });

  it('NO menciona el formato de salida JSON (eso lo enforza el LLM aparte)', () => {
    const prompt = buildSystemPrompt(MINIMAL);
    expect(prompt).not.toMatch(/JSON/i);
    expect(prompt).not.toMatch(/format.*json/i);
  });

  it('es determinístico — mismo input produce mismo output', () => {
    const a = buildSystemPrompt(MINIMAL);
    const b = buildSystemPrompt(MINIMAL);
    expect(a).toBe(b);
  });

  it('incluye sección REGLAS cuando hay interaction_rules', () => {
    const prompt = buildSystemPrompt({
      ...MINIMAL,
      interaction_rules: ['evita emojis', 'no halaga al usuario'],
    });
    expect(prompt).toMatch(/REGLAS/);
    expect(prompt).toMatch(/- evita emojis/);
    expect(prompt).toMatch(/- no halaga al usuario/);
  });

  it('omite REGLAS si interaction_rules está vacío o ausente', () => {
    const promptSinReglas = buildSystemPrompt(MINIMAL);
    expect(promptSinReglas).not.toMatch(/REGLAS/);

    const promptArrayVacio = buildSystemPrompt({ ...MINIMAL, interaction_rules: [] });
    expect(promptArrayVacio).not.toMatch(/REGLAS/);
  });
});
