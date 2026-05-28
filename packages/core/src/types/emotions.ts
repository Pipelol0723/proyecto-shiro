/**
 * Emociones reconocidas por el companion.
 *
 * Cada personaje (en `src/character/characters/<nombre>.yaml`) mapea
 * estas emociones a parámetros concretos del TTS (estabilidad, similarity)
 * y a expresiones del avatar (idle, smirk, thinking, etc.).
 *
 * El enum está pensado para el personaje principal Shiro — reservada,
 * analítica, sarcástica sutil. Si llega un personaje futuro con perfil
 * más expresivo (entusiasta, dramático), evaluar añadir emociones nuevas
 * aquí. La regla: solo entran al enum si al menos un personaje las usa
 * activamente.
 *
 * Si añades una emoción aquí, el archivo del personaje activo debe
 * mapearla en `emotions:` o el AvatarModule cae a `idle` por defecto.
 */
export type Emotion = 'neutral' | 'divertida' | 'pensativa' | 'molesta' | 'vulnerable';

/**
 * Lista runtime de emociones válidas. Útil para validar inputs externos
 * (p. ej. respuesta del LLM clasificando emoción) sin caer en `as Emotion`.
 */
export const EMOTIONS: readonly Emotion[] = [
  'neutral',
  'divertida',
  'pensativa',
  'molesta',
  'vulnerable',
] as const;

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value);
}
