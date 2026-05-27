/**
 * useOrbAmplitude — devuelve un valor de amplitud animada [0..1] usando
 * un loop de requestAnimationFrame, mientras el orb está hablando o
 * escuchando.
 *
 * Cuando llegue audio real (Fase TTS), se reemplaza la simulación por
 * el RMS del buffer de audio en curso. Por ahora son ondas sinusoidales
 * superpuestas para dar sensación orgánica.
 *
 * Es un hook aparte (no inline en Orb.tsx) para:
 * 1. Mantener Orb.tsx focado en render.
 * 2. Permitir tests aislados del hook.
 * 3. Reemplazar la implementación de "fake audio" → "real audio" sin
 *    tocar el componente visual.
 */

import { useEffect, useRef, useState } from 'react';

export interface UseOrbAmplitudeOptions {
  speaking: boolean;
  listening: boolean;
}

export function useOrbAmplitude({ speaking, listening }: UseOrbAmplitudeOptions): number {
  const [amp, setAmp] = useState(0);
  const rafRef = useRef<number | null>(null);
  const tRef = useRef(0);

  useEffect(() => {
    // Si no está activo, fija amplitud a 0 y no programa RAF.
    if (!speaking && !listening) {
      setAmp(0);
      return;
    }

    const tick = (): void => {
      tRef.current += 0.06;
      const t = tRef.current;
      // Ondas sinusoidales superpuestas — frecuencias distintas para
      // que no parezca un loop perfecto. Sumamos y normalizamos a [0..1].
      const v =
        (Math.sin(t * 2.1) * 0.5 + Math.sin(t * 3.7) * 0.3 + Math.sin(t * 5.3) * 0.2) * 0.5 + 0.5;
      // Listening usa ~50% de amplitud — más sutil que speaking.
      const scaled = Math.max(0, Math.min(1, v * (speaking ? 1 : 0.5)));
      setAmp(scaled);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [speaking, listening]);

  return amp;
}
