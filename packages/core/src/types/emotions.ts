/**
 * Emociones reconocidas por el companion.
 *
 * Cada personaje (en `src/character/characters/<nombre>.yaml`) mapea
 * estas emociones a parámetros concretos del TTS (estabilidad, similarity)
 * y a expresiones del avatar (idle, smile, surprised, etc.).
 *
 * Si se añade una emoción nueva aquí, el archivo del personaje debe
 * extenderse correspondientemente o el módulo de avatar usará 'neutral'.
 */
export type Emotion = 'neutral' | 'alegre' | 'pensativa' | 'sorprendida' | 'triste' | 'enojada';

/**
 * Lista runtime de emociones válidas. Útil para validar inputs externos
 * (p. ej. respuesta del LLM clasificando emoción) sin caer en `as Emotion`.
 */
export const EMOTIONS: readonly Emotion[] = [
  'neutral',
  'alegre',
  'pensativa',
  'sorprendida',
  'triste',
  'enojada',
] as const;

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value);
}
