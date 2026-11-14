/**
 * Lector puro de WAV (ADR 0034 §1).
 *
 * Recorre los bloques RIFF desde el byte 12 hasta `data` y calcula la duración
 * a partir del tamaño del bloque de datos, no de la longitud del archivo: Gemini
 * añade tras `data` un bloque `C2PA` de varios KB que falsearía la duración.
 * Sin dependencias de Node (browser-safe).
 */

/** Información básica de un WAV. */
export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Bytes de audio reales del bloque `data` (limitado a lo que hay en el buffer). */
  dataBytes: number;
  durationMs: number;
}

/** El buffer no es un WAV válido o no tiene un formato soportado. */
export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavError';
  }
}

const HEADER_MIN_BYTES = 44;
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Valida la cabecera RIFF/WAVE y devuelve formato y duración del bloque `data`. */
export function parseWav(audio: Uint8Array): WavInfo {
  if (audio.length < HEADER_MIN_BYTES) {
    throw new WavError(
      `Audio demasiado corto para ser un WAV (${audio.length} bytes; mínimo ${HEADER_MIN_BYTES})`,
    );
  }
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  if (readTag(view, 0) !== 'RIFF') throw new WavError('El audio no empieza por RIFF');
  if (readTag(view, 8) !== 'WAVE') throw new WavError('La cabecera RIFF no es de tipo WAVE');

  let format: { sampleRate: number; channels: number; bitsPerSample: number } | undefined;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const id = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ') {
      if (size < 16 || body + 16 > audio.length) throw new WavError('Bloque fmt truncado');
      const tag = view.getUint16(body, true);
      if (tag !== WAVE_FORMAT_PCM && tag !== WAVE_FORMAT_EXTENSIBLE) {
        throw new WavError(`Formato de audio no soportado (${tag}): solo PCM`);
      }
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format) throw new WavError('El bloque data aparece antes que fmt');
      const dataBytes = Math.min(size, audio.length - body);
      if (dataBytes <= 0) throw new WavError('El bloque data está vacío');
      const bytesPerSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8);
      if (!(bytesPerSecond > 0)) throw new WavError('Formato WAV con tasa de bytes inválida');
      return { ...format, dataBytes, durationMs: (dataBytes / bytesPerSecond) * 1000 };
    }
    // Los bloques se rellenan a longitud par.
    offset = body + size + (size % 2);
  }
  throw new WavError(format ? 'Falta el bloque data' : 'Faltan los bloques fmt y data');
}
