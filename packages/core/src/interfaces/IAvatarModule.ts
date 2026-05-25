import type { Emotion } from '../types/emotions.js';

/**
 * Contrato de un módulo de avatar visual.
 *
 * Implementaciones previstas:
 * - `Live2DAvatar` (Fase 6, 2D): Cubism SDK Web + Three.js.
 * - `VRMAvatar` (post-MVP, 3D): `@pixiv/three-vrm`.
 *
 * El módulo NO maneja audio — solo expresión visual y lip sync.
 * El audio lo reproduce el cliente desktop directamente; el avatar
 * recibe el buffer para sincronizar los morph targets de la boca.
 */
export interface IAvatarModule {
  readonly id: string;

  /**
   * Cambia la expresión del avatar a la emoción indicada.
   * El mapeo emoción → morph target/animación vive en el archivo
   * del personaje (`src/character/characters/<nombre>.yaml`).
   */
  setExpression(emotion: Emotion): Promise<void>;

  /**
   * Inicia animación de lip sync analizando el buffer de audio.
   * Devuelve cuando termina el audio (o cuando se llama a `stop`).
   */
  startLipSync(audio: Buffer): Promise<void>;

  /**
   * Detiene cualquier animación en curso. El idle automático vuelve
   * por su cuenta.
   */
  stop(): Promise<void>;
}
