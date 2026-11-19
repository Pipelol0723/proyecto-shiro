/**
 * El procesador de captura (un AudioWorklet) fuera del navegador: se le dan
 * los globales que espera y se le pasa audio a mano.
 *
 * P-15b, R-078: el procesador junta 250 ms antes de entregar. Al soltar la
 * tecla, lo que tenía a medias se perdía, y con ello el final de la frase.
 * Ahora se le puede pedir lo pendiente.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

interface Port {
  postMessage: ReturnType<typeof vi.fn<(data: unknown, transfer?: unknown[]) => void>>;
  onmessage: ((event: { data: unknown }) => void) | null;
}

interface Processor {
  port: Port;
  process(inputs: Float32Array[][]): boolean;
}

type ProcessorCtor = new (options?: { processorOptions?: Record<string, number> }) => Processor;

const SAMPLE_RATE = 16_000;
/** Lo que junta antes de entregar: 250 ms. */
const CHUNK_SAMPLES = SAMPLE_RATE / 4;

let Ctor: ProcessorCtor | undefined;

beforeAll(async () => {
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      port: Port = { postMessage: vi.fn(), onmessage: null };
    },
  );
  vi.stubGlobal('sampleRate', SAMPLE_RATE);
  vi.stubGlobal('registerProcessor', (_name: string, ctor: ProcessorCtor) => {
    Ctor = ctor;
  });
  // Es JavaScript suelto, sin tipos: se carga por su ruta y se registra solo.
  const modulePath = '../../src/audio/pcm-capture-processor.js';
  await import(/* @vite-ignore */ modulePath);
});

function makeProcessor(): Processor {
  if (Ctor === undefined) throw new Error('el procesador no se registró');
  return new Ctor({ processorOptions: { targetSampleRate: SAMPLE_RATE } });
}

/** Le pasa audio como el navegador: en tandas de 128 muestras. */
function feed(processor: Processor, samples: number): void {
  for (let sent = 0; sent < samples; sent += 128) {
    const frame = new Float32Array(Math.min(128, samples - sent)).fill(0.5);
    processor.process([[frame]]);
  }
}

/** Lo que ha mandado al hilo principal, en orden: bytes de audio o el aviso. */
function sent(processor: Processor): (number | string)[] {
  return processor.port.postMessage.mock.calls.map(([data]) => {
    if (data instanceof ArrayBuffer) return data.byteLength;
    return (data as { type: string }).type;
  });
}

function ask(processor: Processor, data: unknown): void {
  processor.port.onmessage?.({ data });
}

describe('pcm-capture-processor', () => {
  it('junta 250 ms de audio antes de entregarlo', () => {
    const processor = makeProcessor();

    feed(processor, CHUNK_SAMPLES - 1);
    expect(sent(processor)).toEqual([]);

    feed(processor, 1);
    expect(sent(processor)).toEqual([CHUNK_SAMPLES * 2]);
  });

  it('al pedirle lo pendiente lo entrega y después avisa de que ya está', () => {
    const processor = makeProcessor();
    feed(processor, 1_000);

    ask(processor, { type: 'flush' });

    expect(sent(processor)).toEqual([2_000, 'flushed']);
  });

  it('sin nada pendiente, solo avisa', () => {
    const processor = makeProcessor();

    ask(processor, { type: 'flush' });

    expect(sent(processor)).toEqual(['flushed']);
  });

  it('después de entregar lo pendiente empieza de cero', () => {
    const processor = makeProcessor();
    feed(processor, 1_000);
    ask(processor, { type: 'flush' });

    feed(processor, CHUNK_SAMPLES);

    expect(sent(processor)).toEqual([2_000, 'flushed', CHUNK_SAMPLES * 2]);
  });

  it('un mensaje que no entiende no hace nada', () => {
    const processor = makeProcessor();
    feed(processor, 1_000);

    ask(processor, 'flush');
    ask(processor, { type: 'otra-cosa' });
    ask(processor, null);

    expect(sent(processor)).toEqual([]);
  });
});
