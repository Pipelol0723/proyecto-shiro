import type { Emotion } from '../types/emotions.js';

/**
 * Contrato de un módulo de avatar visual.
 *
 * Implementaciones:
 * - `Live2DAvatar` (hito Avatar Live2D): wrapper de `pixi-live2d-display`
 *   sobre el Cubism SDK oficial. Server-side mantiene state lógico
 *   (expresión actual) y resuelve emoción → expressionName desde el
 *   character YAML; el render real corre en el cliente desktop con
 *   PixiJS. Ver ADR 0021.
 * - `VRMAvatar` (post-MVP, 3D): `@pixiv/three-vrm`. Pendiente.
 *
 * El módulo NO maneja audio — solo expresión visual y lip sync.
 * El audio lo reproduce el cliente desktop directamente; el avatar
 * recibe el buffer para sincronizar los morph targets de la boca.
 * En la implementación Live2D actual el lip-sync se analiza en el
 * cliente con Web Audio API sobre el `HTMLAudioElement` del TTS, así
 * que `startLipSync(audio)` server-side es esencialmente un marker
 * de estado (ADR 0021 sección 5).
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
