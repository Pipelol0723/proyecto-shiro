/**
 * Opciones de Ollama que comparten quien responde (`OllamaLLM`) y quien
 * clasifica (`HybridRouter`). Viven juntas porque tienen que coincidir: los
 * dos usan, por defecto, el mismo modelo.
 */

import { z } from 'zod';

/**
 * Cuánto mantiene Ollama el modelo cargado después de una llamada. Sin
 * decírselo son 5 minutos: tras un rato sin hablar, el siguiente turno pagaba
 * la carga del modelo y el clasificador expiraba (R-141).
 *
 * Vale solo para el modelo de la llamada. El de embeddings lo llama Letta, no
 * este código: para ese hay que arrancar Ollama con `OLLAMA_KEEP_ALIVE`.
 *
 * El modelo sigue ocupando VRAM ese tiempo aunque se cierre la app.
 */
export const DEFAULT_OLLAMA_KEEP_ALIVE = '30m';

/**
 * Ventana de contexto, en tokens. Se fija para que respuesta y clasificador
 * pidan siempre la misma: si un modelo ya cargado recibe una llamada con otro
 * tamaño, Ollama lo recarga, y eso son segundos en cada cambio.
 *
 * 4096 es también lo que usa Ollama por su cuenta con poca VRAM. Fijarlo
 * aquí manda sobre un `OLLAMA_CONTEXT_LENGTH` distinto en el servidor.
 */
export const DEFAULT_OLLAMA_NUM_CTX = 4096;

/** Una duración como las de Go, que es lo que entiende Ollama: `30m`, `1h30m`, `-1m`. */
const DURATION_RE = /^[-+]?(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/;

/**
 * `keep_alive` como lo acepta Ollama: un número de segundos (negativo: no
 * descargar nunca; 0: descargar al terminar) o una duración (`30m`, `1h`).
 * Una cadena que Ollama no entiende, como `"-1"` o `"30"`, haría fallar cada
 * llamada: mejor rechazarla al arrancar.
 */
export const OllamaKeepAliveSchema = z.union([
  z.number(),
  z
    .string()
    .refine(
      (value) => value === '0' || DURATION_RE.test(value),
      'tiene que ser una duración como `30m` o `1h`, o un número de segundos',
    ),
]);

export type OllamaKeepAlive = z.infer<typeof OllamaKeepAliveSchema>;

/** Las mismas opciones, como se llaman en cada módulo: [LLM, clasificador]. */
const OPTION_NAMES: readonly (readonly [camel: string, snake: string])[] = [
  ['keepAlive', 'keep_alive'],
  ['numCtx', 'num_ctx'],
  ['numPredict', 'num_predict'],
];

/**
 * El LLM escribe sus opciones en camelCase y el clasificador en snake_case
 * (cada esquema ya era así). Una opción escrita con el estilo del otro se
 * descartaba sin avisar, y con ella la garantía de que los dos pidan el mismo
 * contexto. Devuelve el aviso para la primera que encuentre, o `null`.
 */
export function misnamedOllamaOption(rawConfig: unknown, style: 'camel' | 'snake'): string | null {
  if (typeof rawConfig !== 'object' || rawConfig === null) return null;
  for (const [camel, snake] of OPTION_NAMES) {
    const wrong = style === 'camel' ? snake : camel;
    const right = style === 'camel' ? camel : snake;
    if (Object.hasOwn(rawConfig, wrong)) {
      return `\`${wrong}\` no es una opción de este módulo: aquí se escribe \`${right}\``;
    }
  }
  return null;
}

/**
 * Lo que se puede interpretar del contenido de una cadena JSON que quizá se
 * cortó: llega hasta el último escape completo. Recorre los escapes de dos en
 * dos, así que `\\u` (una barra escapada y una «u») no se confunde con un
 * escape Unicode a medias.
 */
function completeEscapes(raw: string): string {
  let end = 0;
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== '\\') {
      i += 1;
    } else if (raw[i + 1] === undefined) {
      break; // una barra suelta al final
    } else if (raw[i + 1] !== 'u') {
      i += 2;
    } else if (/^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
      i += 6;
    } else {
      break; // `\u` sin sus cuatro dígitos
    }
    end = i;
  }
  return raw.slice(0, end);
}

/**
 * Saca el texto de una respuesta estructurada que llegó cortada, por ejemplo
 * `{"text":"Había una vez` (el modelo llegó al tope de longitud). `complete`
 * dice si el texto llegó entero y lo cortado fue lo de después. Devuelve
 * `null` si no llegó nada de texto que se pueda entregar.
 */
export function salvageTruncatedText(content: string): { text: string; complete: boolean } | null {
  const match = /"text"\s*:\s*"((?:[^"\\]|\\.)*)/s.exec(content);
  if (match === null) return null;
  const complete = content[match.index + match[0].length] === '"';
  let text: unknown;
  try {
    text = JSON.parse(`"${completeEscapes(match[1] ?? '')}"`);
  } catch {
    return null;
  }
  if (typeof text !== 'string') return null;
  // Medio emoji: la primera mitad de un par, sin la segunda.
  const whole = text.replace(/[\uD800-\uDBFF]$/, '');
  return whole.trim() === '' ? null : { text: whole, complete };
}
