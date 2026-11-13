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
 *
 * Si la conexión con el core-host pasa de `open` a otro estado, corta en local
 * la frase que suena y avisa al reducer (`VOICE_CUT`) para que el chat lo
 * muestre. Por eso va dentro de `CompanionProvider` y `ConnectionProvider`.
 */

import { createContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useBus } from '../use-bus';
import { useConnectionState } from '../connection/use-connection';
import { useCompanion } from '../state/use-companion';
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
  const { muted, setMuted, cancel, cutLocal, audioElement } = playback;

  // Misma transición que dispara `CONNECTION_LOST` en `CompanionProvider`. El
  // corte es local (sin bus: con la conexión caída el envío se rechazaría) y
  // solo se avisa si de verdad había una frase sonando.
  const [, dispatch] = useCompanion();
  const connection = useConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current === 'open' && connection !== 'open' && cutLocal()) {
      dispatch({ type: 'VOICE_CUT' });
    }
    previous.current = connection;
  }, [connection, cutLocal, dispatch]);
  // El hook devuelve un objeto nuevo en cada render; se estabiliza para que
  // un re-render del padre no repinte a todos los consumidores.
  const value = useMemo(
    () => ({ muted, setMuted, cancel, cutLocal, audioElement }),
    [muted, setMuted, cancel, cutLocal, audioElement],
  );
  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}
