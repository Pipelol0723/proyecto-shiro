/**
 * AudioWorkletProcessor que convierte Float32 → Int16 LE y opcionalmente
 * decima al sample rate objetivo. Corre en el AudioWorklet thread (no
 * en el main thread), así que el GC del main thread no le afecta y la
 * latencia es predecible.
 *
 * Diseñado para alimentar al microservicio Whisper, que espera:
 *   - PCM Int16 LE mono al sample_rate configurado (default 16 kHz).
 *
 * Estrategia de sample rate:
 *
 * El main thread crea el `AudioContext` pidiendo `sampleRate: 16000`. Si
 * el browser cumple, este worklet recibe samples ya a 16 kHz y solo
 * convierte el formato. Si el browser entrega un sample rate distinto
 * (lo expone vía `processorOptions.sourceSampleRate`), decima de forma
 * naive — tomar 1 de cada N. Es subóptimo (mete aliasing) pero
 * suficiente para STT en V1; un filtro polifásico se puede añadir
 * después sin cambiar el contrato.
 *
 * Acumula ~250 ms de audio antes de emitir un mensaje al main thread
 * para reducir overhead de postMessage (128 samples/llamada al `process`
 * son ~8 ms a 16 kHz; postear cada vez serían 125 msgs/s).
 *
 * Este archivo es **JavaScript puro** porque los AudioWorklets se
 * cargan vía `audioWorklet.addModule(url)` desde un archivo servido
 * directamente — TypeScript añadiría un paso de transpilación que
 * no aporta valor en un archivo de ~80 líneas.
 */

/* global AudioWorkletProcessor, registerProcessor, sampleRate */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.targetSampleRate = opts.targetSampleRate ?? 16000;
    // `sampleRate` global del worklet === sampleRate del AudioContext
    // que lo aloja. El main thread también nos puede pasar el valor;
    // si difieren, gana el global (que es el real).
    this.sourceSampleRate = typeof sampleRate === 'number' ? sampleRate : opts.sourceSampleRate;
    // Cuánto decimar. 1 = sin decimación. >1 = naive (drop samples).
    this.decimation =
      this.sourceSampleRate > this.targetSampleRate
        ? Math.round(this.sourceSampleRate / this.targetSampleRate)
        : 1;
    // Buffer interno para acumular ~250 ms antes de postear.
    this.flushSize = Math.floor(this.targetSampleRate * 0.25);
    this.buffer = new Int16Array(this.flushSize);
    this.bufferIndex = 0;
    this.decimationCounter = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    for (let i = 0; i < channel.length; i += 1) {
      // Decimación naive: 1 de cada N samples.
      if (this.decimation > 1) {
        this.decimationCounter += 1;
        if (this.decimationCounter < this.decimation) continue;
        this.decimationCounter = 0;
      }

      // Clamp a [-1, 1] y convierte a Int16 LE.
      const s = Math.max(-1, Math.min(1, channel[i]));
      // Mapeo asimétrico clásico: positivo usa 0x7FFF, negativo 0x8000.
      this.buffer[this.bufferIndex] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.bufferIndex += 1;

      if (this.bufferIndex >= this.flushSize) {
        // Crear copia transferible del buffer lleno.
        const out = this.buffer.slice(0, this.bufferIndex);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
