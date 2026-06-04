/**
 * Carga y disponibilidad del modelo Live2D.
 *
 * **Disponibilidad sin descargar todo el modelo**: antes de montar PIXI,
 * el `<Avatar>` quiere saber si el archivo `.model3.json` existe y es
 * accesible. Un HEAD a la URL nos dice 200 vs 404 sin descargar texturas
 * (~MB). Si el HEAD falla por cualquier motivo, asumimos no disponible
 * y caemos al Orbe.
 *
 * **Por qué no cargar de una vez**: separar "detección de presencia" de
 * "load real" simplifica el flujo del `<Avatar>`. El primer mount: HEAD
 * → si OK, monta PixiJS; si no, renderiza Orbe directamente. Sin try/catch
 * gigante alrededor del componente.
 */

/**
 * Devuelve `true` si la URL responde con 2xx a un HEAD request. Nunca
 * lanza — un fail (404, red, CORS) se trata como "no disponible".
 */
export async function isModelReachable(modelPath: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const response = await fetch(modelPath, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
