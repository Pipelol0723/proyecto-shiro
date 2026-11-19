/**
 * Opciones compartidas de Ollama (P-16).
 *
 * `salvageTruncatedText`: el texto de una respuesta estructurada que llegó
 * cortada. El modelo emite `{"text": "...", "emotion": "..."}` y, si alcanza
 * el tope de longitud, el JSON se queda a medias.
 */

import { describe, expect, it } from 'vitest';
import {
  OllamaKeepAliveSchema,
  misnamedOllamaOption,
  salvageTruncatedText,
} from '../../../../src/modules/llm/ollama-options.js';

describe('salvageTruncatedText', () => {
  it('devuelve lo que llegó del texto, y dice que quedó a medias', () => {
    expect(salvageTruncatedText('{"text":"Había una vez')).toEqual({
      text: 'Había una vez',
      complete: false,
    });
    expect(salvageTruncatedText('{ "text" : "con espacios')?.text).toBe('con espacios');
  });

  it('si el texto llegó entero y lo que se cortó fue lo de después, lo dice', () => {
    expect(salvageTruncatedText('{"text":"entero","emotion":"hap')).toEqual({
      text: 'entero',
      complete: true,
    });
    expect(salvageTruncatedText('{"text":"entero"')?.complete).toBe(true);
  });

  it('interpreta los escapes completos: comillas, saltos de línea y Unicode', () => {
    expect(salvageTruncatedText('{"text":"dijo \\"hola\\" y\\nse fue')?.text).toBe(
      'dijo "hola" y\nse fue',
    );
    expect(salvageTruncatedText('{"text":"ma\\u00f1ana')?.text).toBe('mañana');
  });

  it('descarta un escape que quedó a medias al final', () => {
    expect(salvageTruncatedText('{"text":"hola\\')?.text).toBe('hola');
    expect(salvageTruncatedText('{"text":"hola\\u00')?.text).toBe('hola');
    expect(salvageTruncatedText('{"text":"hola\\u00e')?.text).toBe('hola');
  });

  it('una barra invertida escapada seguida de «u» no es un escape Unicode a medias', () => {
    // El texto real es `C:\users\u`: las barras van escapadas en el JSON.
    expect(salvageTruncatedText('{"text":"ruta C:\\\\users\\\\u')?.text).toBe('ruta C:\\users\\u');
    expect(salvageTruncatedText('{"text":"a\\\\u00')?.text).toBe('a\\u00');
    expect(salvageTruncatedText('{"text":"a\\\\')?.text).toBe('a\\');
  });

  it('no deja medio emoji al final', () => {
    // Un emoji son dos escapes; si se corta entre los dos, sobra el primero.
    expect(salvageTruncatedText('{"text":"hola \\ud83d')?.text).toBe('hola ');
    expect(salvageTruncatedText('{"text":"hola \\ud83d\\ude0')?.text).toBe('hola ');
    expect(salvageTruncatedText('{"text":"hola \\ud83d\\ude00')?.text).toBe('hola 😀');
  });

  it('vale aunque el texto no sea el primer campo', () => {
    expect(salvageTruncatedText('{"emotion":"happy","text":"qué bien')?.text).toBe('qué bien');
    // Un «text» dentro del valor de otro campo va con las comillas escapadas.
    expect(salvageTruncatedText('{"emotion":"\\"text\\":\\"no\\"","text":"sí')?.text).toBe('sí');
  });

  it('sin texto que entregar devuelve null', () => {
    expect(salvageTruncatedText('{"emotion":"happy","te')).toBeNull();
    expect(salvageTruncatedText('{"text":"')).toBeNull();
    expect(salvageTruncatedText('{"text":"   ')).toBeNull();
    expect(salvageTruncatedText('{"text":"\\ud83d')).toBeNull();
    expect(salvageTruncatedText('{"text":42')).toBeNull();
    expect(salvageTruncatedText('')).toBeNull();
    expect(salvageTruncatedText('no es json')).toBeNull();
  });
});

describe('OllamaKeepAliveSchema', () => {
  it.each(['30m', '1h', '1h30m', '90s', '-1m', '0', 3600, -1, 0])(
    'acepta %s, como Ollama',
    (value) => {
      expect(OllamaKeepAliveSchema.parse(value)).toBe(value);
    },
  );

  it.each(['-1', '30', 'media hora', '', '30 m', '1d'])(
    'rechaza «%s»: Ollama contestaría con un error en cada llamada',
    (value) => {
      expect(() => OllamaKeepAliveSchema.parse(value)).toThrow();
    },
  );
});

describe('misnamedOllamaOption', () => {
  it('avisa de una opción escrita con el estilo del otro módulo', () => {
    expect(misnamedOllamaOption({ model: 'm', num_ctx: 8192 }, 'camel')).toMatch(/numCtx/);
    expect(misnamedOllamaOption({ keep_alive: '5m' }, 'camel')).toMatch(/keepAlive/);
    expect(misnamedOllamaOption({ numPredict: 32 }, 'snake')).toMatch(/num_predict/);
  });

  it('con las opciones bien escritas, o sin ellas, no dice nada', () => {
    expect(misnamedOllamaOption({ model: 'm', numCtx: 8192 }, 'camel')).toBeNull();
    expect(misnamedOllamaOption({ num_ctx: 8192 }, 'snake')).toBeNull();
    expect(misnamedOllamaOption({}, 'camel')).toBeNull();
    expect(misnamedOllamaOption(undefined, 'snake')).toBeNull();
  });
});
