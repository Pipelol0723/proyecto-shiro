/**
 * Opciones de Ollama que comparten quien responde (`OllamaLLM`) y quien
 * clasifica (`HybridRouter`). Viven juntas porque tienen que coincidir: los
 * dos usan, por defecto, el mismo modelo.
 */

/**
 * Cuánto mantiene Ollama el modelo cargado después de una llamada. Sin
 * decírselo son 5 minutos: tras un rato sin hablar, el siguiente turno pagaba
 * la carga del modelo y el clasificador y la memoria por parecido expiraban
 * (R-141). Acepta lo mismo que Ollama: una duración (`30m`, `1h`).
 */
export const DEFAULT_OLLAMA_KEEP_ALIVE = '30m';

/**
 * Ventana de contexto, en tokens. Se fija para que respuesta y clasificador
 * pidan la misma: si un modelo ya cargado recibe una llamada con otro tamaño,
 * Ollama lo recarga, y eso son segundos en cada cambio.
 */
export const DEFAULT_OLLAMA_NUM_CTX = 4096;

/**
 * Saca el texto de una respuesta estructurada que llegó cortada, por ejemplo
 * `{"text":"Había una vez` (el modelo llegó a `num_predict`). Devuelve `null`
 * si no llegó nada de texto que se pueda entregar.
 */
export function salvageTruncatedText(content: string): string | null {
  const match = /"text"\s*:\s*"((?:[^"\\]|\\.)*)/s.exec(content);
  if (match === null) return null;
  // Un escape Unicode a medias al final (`\u00`) no se puede interpretar.
  const raw = (match[1] ?? '').replace(/\\u[0-9a-fA-F]{0,3}$/, '');
  try {
    const text: unknown = JSON.parse(`"${raw}"`);
    return typeof text === 'string' && text.trim() !== '' ? text : null;
  } catch {
    return null;
  }
}
