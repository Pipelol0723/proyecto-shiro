/**
 * Tests de parseWav — lector puro de la cabecera RIFF/WAVE (ADR 0034 §1).
 * Los WAV se construyen sintéticos en el propio test; no hay red ni disco.
 */

import { describe, expect, it } from 'vitest';
import { parseWav, WavError } from '../../../../src/modules/tts/wav.js';

interface ChunkSpec {
  id: string;
  body: Uint8Array;
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}

function fmtBody(opts: {
  format?: number;
  channels?: number;
  sampleRate?: number;
  bits?: number;
}): Uint8Array {
  const format = opts.format ?? 1;
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 24000;
  const bits = opts.bits ?? 16;
  const blockAlign = (channels * bits) / 8;
  return Uint8Array.from([
    ...u16(format),
    ...u16(channels),
    ...u32(sampleRate),
    ...u32(sampleRate * blockAlign),
    ...u16(blockAlign),
    ...u16(bits),
  ]);
}

/** Serializa un bloque: id, tamaño declarado, cuerpo y relleno a par. */
function chunk(spec: ChunkSpec, declaredSize?: number): number[] {
  const out = [...ascii(spec.id), ...u32(declaredSize ?? spec.body.length), ...spec.body];
  if (spec.body.length % 2 === 1) out.push(0);
  return out;
}

function riff(chunks: number[][], magic = 'RIFF', form = 'WAVE'): Uint8Array {
  const body = chunks.flat();
  return Uint8Array.from([...ascii(magic), ...u32(4 + body.length), ...ascii(form), ...body]);
}

function silence(bytes: number): Uint8Array {
  return new Uint8Array(bytes);
}

describe('parseWav', () => {
  it('lee un WAV PCM mono de 24 kHz y 16 bits', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'data', body: silence(48000) }),
    ]);
    const info = parseWav(wav);
    expect(info.sampleRate).toBe(24000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataBytes).toBe(48000);
    expect(info.durationMs).toBeCloseTo(1000, 6);
  });

  it('calcula 4,52 s para 216960 bytes de datos', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'data', body: silence(216960) }),
    ]);
    expect(parseWav(wav).durationMs).toBeCloseTo(4520, 6);
  });

  it('ignora un bloque C2PA de 7655 bytes tras data (duración menor que con longitud-44)', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'data', body: silence(216960) }),
      chunk({ id: 'C2PA', body: silence(7655) }),
    ]);
    const info = parseWav(wav);
    const ingenua = ((wav.length - 44) / 48000) * 1000;
    expect(info.dataBytes).toBe(216960);
    expect(info.durationMs).toBeCloseTo(4520, 6);
    expect(info.durationMs).toBeLessThan(ingenua);
  });

  it('salta el relleno de un bloque de tamaño impar', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'LIST', body: silence(5) }),
      chunk({ id: 'data', body: silence(4800) }),
    ]);
    const info = parseWav(wav);
    expect(info.dataBytes).toBe(4800);
    expect(info.durationMs).toBeCloseTo(100, 6);
  });

  it('acepta formato WAVE_FORMAT_EXTENSIBLE', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({ format: 0xfffe }) }),
      chunk({ id: 'data', body: silence(48000) }),
    ]);
    expect(parseWav(wav).sampleRate).toBe(24000);
  });

  it('lanza si no empieza por RIFF', () => {
    const wav = riff(
      [chunk({ id: 'fmt ', body: fmtBody({}) }), chunk({ id: 'data', body: silence(100) })],
      'RIFX',
    );
    expect(() => parseWav(wav)).toThrow(WavError);
  });

  it('lanza si no es WAVE', () => {
    const wav = riff(
      [chunk({ id: 'fmt ', body: fmtBody({}) }), chunk({ id: 'data', body: silence(100) })],
      'RIFF',
      'AVI ',
    );
    expect(() => parseWav(wav)).toThrow(WavError);
  });

  it('lanza si el formato no es PCM ni extensible', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({ format: 3 }) }),
      chunk({ id: 'data', body: silence(100) }),
    ]);
    expect(() => parseWav(wav)).toThrow(WavError);
  });

  it('lanza si falta data o está vacío', () => {
    const sinData = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'LIST', body: silence(10) }),
    ]);
    const vacio = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'data', body: silence(0) }),
    ]);
    expect(() => parseWav(sinData)).toThrow(/Falta el bloque data/);
    expect(() => parseWav(vacio)).toThrow(/data está vacío/);
  });

  it('lanza con un buffer menor de 44 bytes (JSON de error o MP3)', () => {
    const json = new TextEncoder().encode('{"error":"x"}');
    expect(() => parseWav(json)).toThrow(WavError);
    expect(() => parseWav(new Uint8Array(0))).toThrow(WavError);
  });

  it('limita data al buffer cuando la cabecera miente', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'data', body: silence(4800) }, 1_000_000),
    ]);
    const info = parseWav(wav);
    expect(info.dataBytes).toBe(4800);
    expect(info.durationMs).toBeCloseTo(100, 6);
  });

  it('acepta un fmt extensible de 40 bytes', () => {
    const fmt = Uint8Array.from([
      ...fmtBody({ format: 0xfffe }),
      ...u16(22),
      ...new Uint8Array(22),
    ]);
    const wav = riff([
      chunk({ id: 'fmt ', body: fmt }),
      chunk({ id: 'data', body: silence(48000) }),
    ]);
    expect(fmt.length).toBe(40);
    expect(parseWav(wav).durationMs).toBeCloseTo(1000, 6);
  });

  it('lanza si data aparece antes que fmt', () => {
    const wav = riff([
      chunk({ id: 'data', body: silence(100) }),
      chunk({ id: 'fmt ', body: fmtBody({}) }),
    ]);
    expect(() => parseWav(wav)).toThrow(/antes que fmt/);
  });

  it('lanza con tasa de bytes inválida (frecuencia o bits a 0)', () => {
    for (const opts of [{ sampleRate: 0 }, { bits: 0 }]) {
      const wav = riff([
        chunk({ id: 'fmt ', body: fmtBody(opts) }),
        chunk({ id: 'data', body: silence(100) }),
      ]);
      expect(() => parseWav(wav)).toThrow(/tasa de bytes/);
    }
  });

  it('lee un subarray con byteOffset distinto de 0', () => {
    const wav = riff([
      chunk({ id: 'fmt ', body: fmtBody({}) }),
      chunk({ id: 'data', body: silence(4800) }),
    ]);
    const padded = Uint8Array.from([9, 9, 9, ...wav]);
    const info = parseWav(padded.subarray(3));
    expect(info.dataBytes).toBe(4800);
    expect(info.durationMs).toBeCloseTo(100, 6);
  });
});
