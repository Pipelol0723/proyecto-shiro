/**
 * Builder del system prompt — serializa un `Character` a un string en
 * español que el LLM usa como contexto persistente del turno.
 *
 * Pure y browser-safe. Lo usa server-side (cuando el wiring del
 * pipeline construya `LLMRequest`) y opcionalmente cliente-side (si la
 * UI quiere mostrar un preview del prompt en la pantalla Character).
 *
 * Estructura del prompt:
 *
 *   1. Identidad (quién es).
 *   2. Personalidad (rasgos + estilo + likes/dislikes).
 *   3. Backstory (si la hay).
 *   4. Comportamiento (saludo, incertidumbre, registros emocionales).
 *
 * NO incluye el formato de salida (JSON con emoción) — eso lo enforza
 * el LLM por separado (Ollama `format: 'json'`, Anthropic `tool_use`),
 * decidido en ADR 0014.
 */

import type { Character } from './schema.js';

/**
 * Construye el system prompt completo para el personaje dado. El
 * resultado es deterministico — mismo `Character` produce mismo string,
 * útil para cachear y para tests de regresión.
 */
export function buildSystemPrompt(character: Character): string {
  const sections: string[] = [];

  // ─── Cabecera con identidad ───
  const { identity, personality } = character;
  const opener = `Eres ${identity.name}, una AI companion personal. No eres un asistente — tienes opiniones, curiosidad genuina y capacidad de discrepar amablemente.`;
  sections.push(opener);

  // ─── Personalidad ───
  const personalityLines: string[] = ['PERSONALIDAD'];
  personalityLines.push(`- Pronombres: ${identity.pronouns}`);
  if (identity.age_apparent !== undefined) {
    personalityLines.push(`- Edad aparente: ${identity.age_apparent}`);
  }
  personalityLines.push(`- Rasgos: ${personality.traits.join(', ')}`);
  personalityLines.push(`- Estilo al hablar: ${personality.speech_style}`);
  if (personality.likes && personality.likes.length > 0) {
    personalityLines.push(`- Te gusta: ${personality.likes.join(', ')}`);
  }
  if (personality.dislikes && personality.dislikes.length > 0) {
    personalityLines.push(`- Evitas: ${personality.dislikes.join(', ')}`);
  }
  sections.push(personalityLines.join('\n'));

  // ─── Backstory (opcional) ───
  if (character.backstory !== undefined && character.backstory.trim().length > 0) {
    sections.push(`CONTEXTO\n${character.backstory.trim()}`);
  }

  // ─── Comportamiento (opcional) ───
  if (character.behaviors) {
    const lines: string[] = ['COMPORTAMIENTO'];
    if (character.behaviors.greeting_style !== undefined) {
      lines.push(`- Al saludar: ${character.behaviors.greeting_style}`);
    }
    if (character.behaviors.uncertainty_style !== undefined) {
      lines.push(`- Cuando no sabes algo: ${character.behaviors.uncertainty_style}`);
    }
    if (character.behaviors.emotional_register) {
      const entries = Object.entries(character.behaviors.emotional_register);
      if (entries.length > 0) {
        lines.push('- Adaptas el tono según el contexto:');
        for (const [register, instruction] of entries) {
          lines.push(`  - ${register}: ${instruction}`);
        }
      }
    }
    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
