/**
 * Textos de los fallos del micrófono y del oído (P-15a, R-288): en español,
 * diciendo qué pasó y qué hacer, sin el mensaje crudo del navegador.
 */

import { describe, expect, it } from 'vitest';
import { describeMicError } from '../../src/audio/mic-error-text';
import { WhisperSttError, type SttFailureCode } from '../../src/audio/whisper-stt-client';

/** Un error con el `name` que pone el navegador en `getUserMedia`. */
function domError(name: string, message = 'Permission denied'): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('describeMicError', () => {
  it.each([
    ['NotAllowedError', /permiso/i, /Windows/],
    ['SecurityError', /permiso/i, /Windows/],
    ['NotFoundError', /ningún micrófono/i, /conecta/i],
    ['OverconstrainedError', /ningún micrófono/i, /conecta/i],
    ['NotReadableError', /no responde/i, /otra aplicación/i],
    ['AbortError', /no responde/i, /otra aplicación/i],
  ])('%s dice qué pasa y qué hacer', (name, what, action) => {
    const text = describeMicError(domError(name));
    expect(text).toMatch(what);
    expect(text).toMatch(action);
    // El mensaje crudo del navegador no se enseña.
    expect(text).not.toContain('Permission denied');
    expect(text).not.toContain(name);
  });

  it.each<[SttFailureCode, RegExp]>([
    ['connect', /Setup/],
    ['connect-timeout', /Setup/],
    ['final-timeout', /otra vez/i],
    ['closed', /otra vez/i],
    ['server', /otra vez/i],
  ])('un fallo de Whisper de tipo «%s» nombra a Whisper y dice qué hacer', (code, action) => {
    const text = describeMicError(new WhisperSttError(code, 'fallo al conectar a ws://x:8765/stt'));
    expect(text).toMatch(/Whisper/);
    expect(text).toMatch(action);
    expect(text).not.toContain('ws://');
  });

  it('conectar y no terminar de transcribir no dicen lo mismo', () => {
    const connect = describeMicError(new WhisperSttError('connect-timeout', 'x'));
    const final = describeMicError(new WhisperSttError('final-timeout', 'x'));
    expect(connect).not.toBe(final);
  });

  it('lo que no reconoce lo dice con el mensaje original, para poder buscarlo', () => {
    expect(describeMicError(new Error('worklet roto'))).toMatch(/worklet roto/);
    expect(describeMicError('texto suelto')).toMatch(/texto suelto/);
  });

  it('todos los textos acaban en punto y están en español', () => {
    const samples = [
      describeMicError(domError('NotAllowedError')),
      describeMicError(domError('NotFoundError')),
      describeMicError(new WhisperSttError('connect', 'x')),
      describeMicError(new Error('otro')),
    ];
    for (const text of samples) {
      expect(text.endsWith('.')).toBe(true);
      expect(text).not.toMatch(/\b(error|failed|denied)\b/i);
    }
  });
});
