/**
 * useLipSync — sincroniza la apertura de boca del modelo Live2D con el
 * audio del TTS que ya está sonando en el cliente (ADR 0021 §5).
 *
 * Idea: el `HTMLAudioElement` del TTS (expuesto por `useTtsPlayback`) se
 * conecta a un `AudioContext` → `MediaElementAudioSourceNode` →
 * `AnalyserNode`. Cada frame leemos la energía del espectro
 * (`getByteFrequencyData`), la convertimos en un valor 0..1 y lo
 * escribimos en el parámetro de boca del modelo (`ParamMouthOpenY`).
 *
 * **Desacople del modelo**: el hook NO conoce el tipo de Live2D. Recibe
 * un callback `setMouthOpen(value)` que el `<Live2DCanvas>` implementa
 * escribiendo en `model.internalModel.coreModel`. Así el hook es
 * testeable sin WebGL ni el modelo real.
 *
 * **Gotchas de Web Audio resueltos aquí**:
 * - Un `HTMLAudioElement` solo puede conectarse a UN
 *   `MediaElementAudioSourceNode` en toda su vida. Cacheamos el analyser
 *   por elemento (`WeakMap`) para sobrevivir el doble montaje de
 *   React StrictMode en dev sin lanzar "already connected".
 * - El source enruta el audio por el grafo, así que conectamos
 *   `source → analyser → destination` para que el sonido siga oyéndose.
 * - El `AudioContext` puede arrancar suspendido; lo reanudamos (ya hubo
 *   gesto del usuario cuando empezó a sonar el TTS).
 * - CORS: el `<audio>` debe tener `crossOrigin="anonymous"` (lo pone
 *   `useTtsPlayback`), si no el analyser devuelve solo ceros.
 *
 * Cuando `audioElement` es `null` (sin audio, o cliente muteado) la boca
 * se cierra (`setMouthOpen(0)`) y no se monta nada.
 */

import { useEffect, useRef } from 'react';

/** Ganancia por defecto: la RMS del habla normalizada suele ser baja. */
const DEFAULT_GAIN = 1.7;
/** Suavizado por frame (lerp) para que la boca no tiemble. 0..1. */
const DEFAULT_SMOOTHING = 0.45;
/** fftSize chico = barato y suficiente para detectar energía de voz. */
const FFT_SIZE = 256;

export interface UseLipSyncOptions {
  /** El `<audio>` que está sonando, o `null`. Viene de `useTtsPlayback`. */
  audioElement: HTMLAudioElement | null;
  /**
   * Escribe el valor de apertura de boca (0..1) en el modelo. `null`
   * cuando el modelo aún no está listo. El `<Live2DCanvas>` lo conecta a
   * `model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', v)`.
   */
  setMouthOpen: ((value: number) => void) | null;
  /** Desactiva el lip-sync sin desmontar (default true). */
  enabled?: boolean;
  /** Multiplicador de amplitud. Default 1.7. */
  gain?: number;
  /** Suavizado por frame (0 = sin suavizar, 1 = instantáneo). Default 0.45. */
  smoothing?: number;
  /** Solo tests: inyecta un `AudioContext` mockeable. */
  audioContextFactory?: () => AudioContext;
}

/**
 * Convierte el espectro de frecuencias (bytes 0..255) en un valor de
 * apertura de boca 0..1. Pura — fácil de testear. RMS de la energía,
 * normalizada, por `gain`, con clamp a [0, 1].
 */
export function computeMouthOpen(freqData: Uint8Array, gain = DEFAULT_GAIN): number {
  if (freqData.length === 0) return 0;
  let sum = 0;
  for (const v of freqData) {
    sum += v * v;
  }
  const rms = Math.sqrt(sum / freqData.length) / 255;
  const scaled = rms * gain;
  if (scaled < 0) return 0;
  if (scaled > 1) return 1;
  return scaled;
}

/**
 * Obtiene (o crea y cachea) el `AnalyserNode` enganchado al elemento.
 * Devuelve `null` si `createMediaElementSource` lanza (p.ej. el elemento
 * ya estaba conectado a otro source fuera de nuestro control).
 */
function attachAnalyser(
  ctx: AudioContext,
  el: HTMLAudioElement,
  cache: WeakMap<HTMLAudioElement, AnalyserNode>,
): AnalyserNode | null {
  const cached = cache.get(el);
  if (cached !== undefined) return cached;
  try {
    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    cache.set(el, analyser);
    return analyser;
  } catch {
    return null;
  }
}

export function useLipSync(options: UseLipSyncOptions): void {
  const {
    audioElement,
    setMouthOpen,
    enabled = true,
    gain = DEFAULT_GAIN,
    smoothing = DEFAULT_SMOOTHING,
    audioContextFactory,
  } = options;

  // Una sola AudioContext por instancia del hook; NO se cierra en el
  // cleanup para no invalidar el source cacheado del elemento.
  const ctxRef = useRef<AudioContext | null>(null);
  // Analyser cacheado por elemento (clave del fix StrictMode).
  const cacheRef = useRef<WeakMap<HTMLAudioElement, AnalyserNode>>(new WeakMap());
  // Valor actual de boca, para suavizar entre frames.
  const mouthRef = useRef(0);

  useEffect(() => {
    if (!enabled || audioElement === null || setMouthOpen === null) {
      mouthRef.current = 0;
      setMouthOpen?.(0);
      return;
    }

    const ctx = (ctxRef.current ??= audioContextFactory
      ? audioContextFactory()
      : new AudioContext());

    const analyser = attachAnalyser(ctx, audioElement, cacheRef.current);
    if (analyser === null) return;

    void ctx.resume();

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let active = true;

    const loop = (): void => {
      if (!active) return;
      analyser.getByteFrequencyData(data);
      const target = computeMouthOpen(data, gain);
      mouthRef.current += (target - mouthRef.current) * smoothing;
      setMouthOpen(mouthRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      mouthRef.current = 0;
      setMouthOpen(0);
    };
  }, [audioElement, setMouthOpen, enabled, gain, smoothing, audioContextFactory]);
}
