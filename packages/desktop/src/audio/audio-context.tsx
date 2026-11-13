/**
 * AudioProvider — monta `useTtsPlayback` **una sola vez**, por encima del
 * switch de pantallas (mismo patrón que `state/companion-context.tsx`).
 *
 * El bug que arregla (R-058, R-119): el hook vivía en `ConversationScreen`,
 * así que al cambiar de pantalla su cleanup pausaba el audio en curso y,
 * mientras estabas en otra pantalla, un `tts:audio` nuevo no sonaba. Ahora el
 * reproductor vive lo que vive la app; las pantallas lo consumen con
 * `useAudio()` (ver `./use-audio.ts`).
 *
 * Va fuera del `ErrorBoundary`: un fallo de render no corta el audio.
 */

import { createContext, useMemo, type ReactNode } from 'react';
import { useBus } from '../use-bus';
import { useTtsPlayback, type UseTtsPlaybackResult } from './useTtsPlayback';

export type AudioContextValue = UseTtsPlaybackResult;

// El context se exporta para que `./use-audio.ts` lo consuma. Nadie más
// debería importarlo directamente — use `useAudio()`.
// eslint-disable-next-line react-refresh/only-export-components -- el context vive con su Provider, igual que companion-context.tsx.
export const AudioContext = createContext<AudioContextValue | null>(null);

export interface AudioProviderProps {
  children: ReactNode;
  /** Solo para tests — sustituye `new Audio()` por algo mockeable. */
  audioFactory?: () => HTMLAudioElement;
}

export function AudioProvider({ children, audioFactory }: AudioProviderProps): JSX.Element {
  const bus = useBus();
  const playback = useTtsPlayback({ bus, audioFactory });
  const { muted, setMuted, cancel, audioElement } = playback;
  // El hook devuelve un objeto nuevo en cada render; se estabiliza para que
  // un re-render del padre no repinte a todos los consumidores.
  const value = useMemo(
    () => ({ muted, setMuted, cancel, audioElement }),
    [muted, setMuted, cancel, audioElement],
  );
  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}
