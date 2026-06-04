/**
 * Config del avatar Live2D en el cliente desktop.
 *
 * **Por qué hardcoded aquí y no recibido del server**: la config vive
 * en `config/modules.config.yaml` (slot `avatar`) y se valida en el
 * `Live2DAvatar` server-side (ADR 0021, PR #51). El cliente la necesita
 * en bootstrap para montar el render; un endpoint HTTP `/avatar/config`
 * o un evento del bus serían formas limpias de obtenerla, pero son
 * complejidad que no aporta hoy (la config no cambia en runtime y el
 * proyecto es personal).
 *
 * **Regla**: si editas estos valores, edita el YAML server para que
 * matchee. Cuando llegue el modelo definitivo / multi-dispositivo,
 * promovemos a "config viene del server" en un PR aparte.
 */

export interface AvatarRuntimeConfig {
  /** URL pública del `.model3.json` del modelo Live2D. */
  modelPath: string;
  /** URL pública del `Live2DCubismCore.js` (descarga manual desde live2d.com). */
  cubismCoreUrl: string;
  /** Cap de fps del render. 30 default — ADR 0021 §4. */
  maxFps: number;
  /** Si la animación idle automática debe correr. */
  idleAnimation: boolean;
}

/**
 * Defaults del cliente. Espejan los defaults del schema server (ver
 * `Live2DAvatarConfigSchema` en `@proyecto-shiro/core`).
 */
export const AVATAR_CONFIG: AvatarRuntimeConfig = {
  modelPath: '/live2d/models/Hiyori/Hiyori.model3.json',
  cubismCoreUrl: '/live2d/Core/live2dcubismcore.js',
  maxFps: 30,
  idleAnimation: true,
};
