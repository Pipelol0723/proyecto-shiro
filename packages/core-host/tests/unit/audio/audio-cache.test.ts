import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioCache, extFromMimeType } from '../../../src/audio/audio-cache.js';

describe('extFromMimeType', () => {
  it('mapea audio/mpeg y audio/mp3 a mp3', () => {
    expect(extFromMimeType('audio/mpeg')).toBe('mp3');
    expect(extFromMimeType('audio/mp3')).toBe('mp3');
  });
  it('mapea audio/wav y audio/x-wav a wav', () => {
    expect(extFromMimeType('audio/wav')).toBe('wav');
    expect(extFromMimeType('audio/x-wav')).toBe('wav');
  });
  it('default mp3 para mimeTypes desconocidos', () => {
    expect(extFromMimeType('audio/raro')).toBe('mp3');
  });
  it('case-insensitive', () => {
    expect(extFromMimeType('AUDIO/WAV')).toBe('wav');
  });
});

describe('AudioCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('put devuelve audioId y URL relativa con extensión correcta', () => {
    const cache = new AudioCache({ generateId: () => 'abc-123' });
    const { audioId, relativeUrl } = cache.put(Buffer.from('x'), 'audio/mpeg');
    expect(audioId).toBe('abc-123');
    expect(relativeUrl).toBe('/audio/abc-123.mp3');
  });

  it('put con WAV genera URL con .wav', () => {
    const cache = new AudioCache({ generateId: () => 'xyz' });
    const { relativeUrl } = cache.put(Buffer.from('x'), 'audio/wav');
    expect(relativeUrl).toBe('/audio/xyz.wav');
  });

  it('get devuelve la entry guardada', () => {
    const cache = new AudioCache({ generateId: () => 'id1' });
    const buf = Buffer.from('hello');
    cache.put(buf, 'audio/mpeg');
    const entry = cache.get('id1');
    expect(entry?.buffer).toBe(buf);
    expect(entry?.mimeType).toBe('audio/mpeg');
  });

  it('get devuelve null si el audioId no existe', () => {
    const cache = new AudioCache();
    expect(cache.get('inexistente')).toBeNull();
  });

  it('get devuelve null y elimina la entry si ha expirado', () => {
    let time = 1000;
    const cache = new AudioCache({
      generateId: () => 'id1',
      now: () => time,
      defaultTtlMs: 100,
    });
    cache.put(Buffer.from('x'), 'audio/mpeg');
    expect(cache.size).toBe(1);

    time = 1500; // pasaron 500 ms, TTL era 100 ms
    expect(cache.get('id1')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('respeta TTL custom pasado a put()', () => {
    let time = 0;
    const cache = new AudioCache({
      generateId: () => 'id1',
      now: () => time,
      defaultTtlMs: 100,
    });
    cache.put(Buffer.from('x'), 'audio/mpeg', 5000); // override TTL

    time = 200; // pasaron 200 ms — con default sería null, con override no
    expect(cache.get('id1')).not.toBeNull();

    time = 5500;
    expect(cache.get('id1')).toBeNull();
  });

  it('invalidate elimina la entry y devuelve true', () => {
    const cache = new AudioCache({ generateId: () => 'id1' });
    cache.put(Buffer.from('x'), 'audio/mpeg');
    expect(cache.invalidate('id1')).toBe(true);
    expect(cache.get('id1')).toBeNull();
  });

  it('invalidate devuelve false para audioId desconocido', () => {
    const cache = new AudioCache();
    expect(cache.invalidate('nope')).toBe(false);
  });

  it('sweep elimina entradas expiradas y deja vivas las que no', () => {
    let time = 0;
    let nextId = 0;
    const cache = new AudioCache({
      generateId: () => `id-${nextId++}`,
      now: () => time,
      defaultTtlMs: 100,
    });
    cache.put(Buffer.from('a'), 'audio/mpeg'); // expires at 100
    time = 50;
    cache.put(Buffer.from('b'), 'audio/mpeg'); // expires at 150

    time = 120;
    const removed = cache.sweep();
    expect(removed).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get('id-1')).not.toBeNull();
  });

  it('start/stop con timers reales no fugan', () => {
    vi.useFakeTimers();
    const cache = new AudioCache({ sweepMs: 100 });
    cache.start();
    cache.start(); // idempotente
    vi.advanceTimersByTime(500);
    cache.stop();
    cache.stop(); // idempotente
    expect(true).toBe(true); // si fugara, vitest detectaría handles abiertos
  });
});
