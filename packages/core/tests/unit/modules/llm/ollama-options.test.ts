/**
 * `salvageTruncatedText`: el texto de una respuesta estructurada que llegó
 * cortada (P-16). El modelo emite `{"text": "...", "emotion": "..."}` y, si
 * alcanza `num_predict`, el JSON se queda a medias.
 */

import { describe, expect, it } from 'vitest';
import { salvageTruncatedText } from '../../../../src/modules/llm/ollama-options.js';

describe('salvageTruncatedText', () => {
  it('devuelve lo que llegó del texto', () => {
    expect(salvageTruncatedText('{"text":"Había una vez')).toBe('Había una vez');
    expect(salvageTruncatedText('{ "text" : "con espacios')).toBe('con espacios');
  });

  it('interpreta los escapes completos: comillas, saltos de línea y Unicode', () => {
    expect(salvageTruncatedText('{"text":"dijo \\"hola\\" y\\nse fue')).toBe(
      'dijo "hola" y\nse fue',
    );
    expect(salvageTruncatedText('{"text":"ma\\u00f1ana')).toBe('mañana');
  });

  it('descarta un escape que quedó a medias al final', () => {
    expect(salvageTruncatedText('{"text":"hola\\')).toBe('hola');
    expect(salvageTruncatedText('{"text":"hola\\u00')).toBe('hola');
  });

  it('vale aunque el texto no sea el primer campo, o ya estuviera cerrado', () => {
    expect(salvageTruncatedText('{"emotion":"happy","text":"qué bien')).toBe('qué bien');
    expect(salvageTruncatedText('{"text":"entero","emotion":"hap')).toBe('entero');
  });

  it('sin texto que entregar devuelve null', () => {
    expect(salvageTruncatedText('{"emotion":"happy","te')).toBeNull();
    expect(salvageTruncatedText('{"text":"')).toBeNull();
    expect(salvageTruncatedText('{"text":"   ')).toBeNull();
    expect(salvageTruncatedText('')).toBeNull();
    expect(salvageTruncatedText('no es json')).toBeNull();
  });
});
