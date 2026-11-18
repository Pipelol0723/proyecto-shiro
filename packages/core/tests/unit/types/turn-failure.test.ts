import { describe, expect, it } from 'vitest';
import { classifyTurnFailure } from '../../../src/types/turn-failure.js';

/** Error envuelto como hacen los módulos LLM: mensaje genérico y motivo en `cause`. */
function wrap(cause: unknown): Error {
  return new Error('fallo al llamar a la API', { cause });
}

describe('classifyTurnFailure', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'quota'],
    [404, 'model-missing'],
    [500, 'unavailable'],
    [529, 'unavailable'],
  ] as const)('un status %i en la causa es «%s»', (status, reason) => {
    const sdkError = Object.assign(new Error('respuesta de la API'), { status });
    expect(classifyTurnFailure(wrap(sdkError))).toBe(reason);
  });

  it('lee el status del propio error aunque no haya causa', () => {
    const err = Object.assign(new Error('OllamaLLM: 404 Not Found'), { status: 404 });
    expect(classifyTurnFailure(err)).toBe('model-missing');
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])(
    'un code %s dos niveles más abajo es «unavailable»',
    (code) => {
      const socketError = Object.assign(new Error('connect'), { code });
      expect(classifyTurnFailure(wrap(new TypeError('fetch failed', { cause: socketError })))).toBe(
        'unavailable',
      );
    },
  );

  it('una petición cortada por el tiempo límite es «unavailable»', () => {
    const aborted = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    expect(classifyTurnFailure(wrap(aborted))).toBe('unavailable');
  });

  it('la etiqueta failureReason que pone el módulo manda sobre las demás pistas', () => {
    const tagged = Object.assign(new Error('no hay clave'), { failureReason: 'missing-key' });
    expect(classifyTurnFailure(tagged)).toBe('missing-key');

    const rateLimited = Object.assign(new Error('demasiadas peticiones'), { status: 429 });
    const wrapper = Object.assign(new Error('envoltorio', { cause: rateLimited }), {
      failureReason: 'unavailable',
    });
    expect(classifyTurnFailure(wrapper)).toBe('unavailable');
  });

  it('una etiqueta que no está en la lista cerrada se ignora', () => {
    const err = Object.assign(new Error('raro'), { failureReason: 'inventado', status: 401 });
    expect(classifyTurnFailure(err)).toBe('auth');
  });

  it('el AggregateError de Node al no poder conectar es «unavailable»', () => {
    const refused = new AggregateError(
      [Object.assign(new Error('connect ECONNREFUSED ::1:11434'), { code: 'ECONNREFUSED' })],
      '',
    );
    Object.assign(refused, { code: 'ECONNREFUSED' });
    expect(classifyTurnFailure(wrap(new TypeError('fetch failed', { cause: refused })))).toBe(
      'unavailable',
    );
  });

  it('gana el primer motivo reconocible de la cadena', () => {
    const socketError = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    const rateLimited = Object.assign(new Error('demasiadas peticiones', { cause: socketError }), {
      status: 429,
    });
    expect(classifyTurnFailure(wrap(rateLimited))).toBe('quota');
  });

  it('un error sin pistas, o algo que no es un error, es «unknown»', () => {
    expect(classifyTurnFailure(new Error('LLM falló'))).toBe('unknown');
    expect(classifyTurnFailure('texto suelto')).toBe('unknown');
    expect(classifyTurnFailure(undefined)).toBe('unknown');
    expect(classifyTurnFailure(Object.assign(new Error('raro'), { status: 418 }))).toBe('unknown');
  });

  it('una cadena de causas circular no se queda colgada', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(classifyTurnFailure(a)).toBe('unknown');
  });
});
