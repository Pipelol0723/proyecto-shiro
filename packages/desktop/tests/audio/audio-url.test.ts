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

  it.each([
    'http://alguien@localhost:9876/audio/a.mp3',
    'http://alguien:clave@localhost:9876/audio/a.mp3',
    '/audio/',
    '/audio/a',
    '/audio//a.mp3',
    '/audio/a/b.mp3',
    '/audio/..%2fx.mp3',
    '/audio/%5c..%5cx.mp3',
    '/audio/%2e%2e/x.mp3',
    '/audio/;x',
    '/audio/a.mp3?x=1',
    '/audio/a.mp3#f',
    '/AUDIO/a.mp3',
  ])('«%s» no tiene la forma de un audio del core-host', (url) => {
    expect(resolveAudioUrl(url, 'ws://localhost:9876/bus')).toBeNull();
  });

  it('la ruta sin barra inicial se resuelve igual', () => {
    expect(resolveAudioUrl('audio/a.mp3', 'ws://localhost:9876/bus')).toBe(
      'http://localhost:9876/audio/a.mp3',
    );
  });

  it('el puerto por defecto y las mayúsculas no hacen de un servidor otro', () => {
    expect(
      resolveAudioUrl('HTTP://SHIRO-HOST.TEST:80/audio/a.mp3', 'ws://shiro-host.test/bus'),
    ).toBe('http://shiro-host.test/audio/a.mp3');
  });

  it('un host con punto final no es el mismo servidor', () => {
    expect(
      resolveAudioUrl('http://localhost:9876/audio/a.mp3', 'ws://localhost.:9876/bus'),
    ).toBeNull();
  });

  it('las credenciales de la dirección del bus no pasan a la del audio', () => {
    expect(resolveAudioUrl('/audio/a.mp3', 'ws://alguien:clave@localhost:9876/bus')).toBe(
      'http://localhost:9876/audio/a.mp3',
    );
  });

  it('si la dirección del bus no se entiende, no se reproduce nada', () => {
    expect(resolveAudioUrl('/audio/a.mp3', 'no es una url')).toBeNull();
    expect(resolveAudioUrl('/audio/a.mp3', 'ftp://shiro-host.test/bus')).toBeNull();
  });
});
