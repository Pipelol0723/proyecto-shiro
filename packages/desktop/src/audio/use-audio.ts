/**
 * Hook de acceso al reproductor TTS global (`AudioProvider`).
 *
 * Separado de `audio-context.tsx` por la convención de Fast Refresh del
 * repo (mismo patrón que `use-companion.ts` y `use-bus.ts`).
 */

import { useContext } from 'react';
import { AudioContext, type AudioContextValue } from './audio-context';

/**
 * Devuelve `{ muted, setMuted, cancel, audioElement }`. Lanza si se usa
 * fuera de `<AudioProvider>` (que App monta en el root).
 */
export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioContext);
  if (ctx === null) {
    throw new Error('useAudio debe usarse dentro de AudioProvider.');
  }
  return ctx;
}
