/**
 * De la ruta que llega en `tts:audio` a la URL que se reproduce (P-14, R-314).
 *
 * El audio lo sirve el mismo core-host al que el cliente está conectado, esté
 * donde esté: la ruta se resuelve contra el origen de esa conexión. Lo que no
 * sea un audio de ese origen no se reproduce.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_HOST_URL, resolveAudioUrl } from '../../src/audio/audio-url';

describe('resolveAudioUrl', () => {
  it.each([
    ['ws://localhost:9876/bus', 'http://localhost:9876/audio/a.mp3'],
    ['ws://shiro-host.test:9000/bus', 'http://shiro-host.test:9000/audio/a.mp3'],
    ['wss://shiro-host.test/bus', 'https://shiro-host.test/audio/a.mp3'],
    ['http://shiro-host.test:9000', 'http://shiro-host.test:9000/audio/a.mp3'],
  ])('con el bus en %s, el audio sale de ese mismo servidor', (hostUrl, expected) => {
    expect(resolveAudioUrl('/audio/a.mp3', hostUrl)).toBe(expected);
  });

  it('sin decir dónde está el bus, usa el de siempre', () => {
    expect(DEFAULT_HOST_URL).toBe('ws://localhost:9876/bus');
    expect(resolveAudioUrl('/audio/a.mp3')).toBe('http://localhost:9876/audio/a.mp3');
  });

  it('una URL completa del mismo servidor también vale', () => {
    expect(resolveAudioUrl('http://localhost:9876/audio/a.mp3', 'ws://localhost:9876/bus')).toBe(
      'http://localhost:9876/audio/a.mp3',
    );
  });

  it.each([
    'http://otro.invalid/audio/a.mp3',
    '//otro.invalid/audio/a.mp3',
    'http://localhost:9999/audio/a.mp3',
    'https://localhost:9876/audio/a.mp3',
    'javascript:alert(1)',
    'data:audio/mpeg;base64,AAAA',
    'blob:http://localhost:9876/1234',
    '/bus',
    '/otra/cosa.mp3',
    '/audio/../secrets',
    '',
  ])('«%s» no se reproduce: no es un audio de este servidor', (url) => {
    expect(resolveAudioUrl(url, 'ws://localhost:9876/bus')).toBeNull();
  });

  it('si la dirección del bus no se entiende, no se reproduce nada', () => {
    expect(resolveAudioUrl('/audio/a.mp3', 'no es una url')).toBeNull();
    expect(resolveAudioUrl('/audio/a.mp3', 'ftp://shiro-host.test/bus')).toBeNull();
  });
});
