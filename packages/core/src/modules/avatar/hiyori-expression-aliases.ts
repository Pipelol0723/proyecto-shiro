/**
 * Mapeo provisional `expression name del YAML del personaje` → `nombre
 * de archivo de expresión que existe en el modelo Hiyori`.
 *
 * Hiyori (sample del Cubism SDK for Web) trae 4 expresiones:
 *
 *   - `default` (idle / neutral)
 *   - `smile`
 *   - `surprise`
 *   - `anger`
 *
 * El YAML del personaje Shiro usa nombres lógicos pensados para el
 * modelo definitivo (`idle`, `smirk`, `thinking`, `annoyed`, `soft`).
 * Mientras Hiyori es el placeholder, traducimos. Cuando llegue el
 * modelo definitivo con expresiones nombradas correctamente (`smirk`,
 * `thinking`, etc.), el `Live2DAvatar` se construirá sin
 * `expressionAliases` y los nombres del YAML llegarán al modelo tal
 * cual — este archivo desaparece o queda como referencia histórica.
 *
 * Ver [ADR 0021](../../../../../docs/adr/0021-avatar-live2d-pixi-display-fallback-orbe.md)
 * sección 2 ("Modelo placeholder: Hiyori") para por qué este mapeo es
 * deuda temporal, no diseño permanente.
 */

/**
 * Tabla del mapeo. Las claves son los `avatar_expression` del YAML del
 * personaje activo; los valores son los nombres de archivo `.exp3.json`
 * dentro de la carpeta del modelo Hiyori.
 *
 * Cada decisión:
 *
 * - `idle → default`: Hiyori no tiene "idle" pero su `default` es la
 *   pose base con los ojos abiertos — equivalente funcional.
 * - `smirk → smile`: Hiyori es expresivamente más cálida que Shiro;
 *   `smile` es la aproximación más cercana al smirk seco.
 * - `thinking → default`: Hiyori no tiene una expresión introspectiva;
 *   caemos a default (neutral) para no forzar un mood que no encaja.
 * - `annoyed → anger`: Hiyori tiene anger pero es más exagerada de lo
 *   que Shiro mostraría; sigue siendo la mejor aproximación disponible.
 * - `soft → default`: Hiyori no tiene una expresión vulnerable / suave;
 *   default es la opción más neutral hasta el modelo definitivo.
 *
 * Las expresiones de Hiyori que NO usamos (`surprise`) quedan no mapeadas
 * — el modelo definitivo de Shiro tampoco las usará probablemente.
 */
export const HIYORI_EXPRESSION_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  idle: 'default',
  smirk: 'smile',
  thinking: 'default',
  annoyed: 'anger',
  soft: 'default',
});
