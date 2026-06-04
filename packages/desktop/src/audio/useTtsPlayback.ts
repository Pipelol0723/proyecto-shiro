/**
 * useTtsPlayback — reproduce los audios TTS que el core-host emite por
 * el bus (`tts:audio`) y emite `tts:audio-ended` al terminar. También
 * responde a `tts:cancel` parando el audio en curso.
 *
 * Diseñado para montarse **una sola vez** (en el root del árbol, o en
 * `ConversationScreen`). Si lo montas varias veces tendrás N
 * reproducciones simultáneas — eco garantizado.
 *
 * Toggle mute persistido en `localStorage` con key
 * `shiro:tts:muted` para que cada dispositivo recuerde su preferencia
 * entre sesiones. El primer cliente conectado tiene mute=false; los
 * demás deberían ponerlo manualmente (la lógica de "elegir dispositivo
 * activo" es ADR futuro para multi-device — ver ADR 0020).
 *
 * Errores de fetch o reproducción no rompen la UI: se loguean y se
 * emite `tts:audio-ended` para desbloquear el estado `speaking` del
 * reducer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';

const STORAGE_KEY = 'shiro:tts:muted';

export interface UseTtsPlaybackOptions {
  bus: IEventBus<EventMap>;
  /**
   * Si `true`, este cliente NO reproduce el audio aunque reciba
   * `tts:audio`. Sigue emitiendo `tts:audio-ended` para que el reducer
   * limpie el estado `speaking`. Útil para clientes secundarios que solo
   * leen los subtítulos.
   */
  muted?: boolean;
  /** Solo para tests — sustituye `new Audio()` por algo mockeable. */
  audioFactory?: () => HTMLAudioElement;
}

export interface UseTtsPlaybackResult {
  muted: boolean;
  setMuted: (next: boolean) => void;
  /**
   * Si hay un audio sonando, emite `tts:cancel` al bus con su audioId.
   * Sin efecto si no hay nada sonando. Útil para que la UI permita
   * "interrumpir a Shiro" al iniciar un nuevo turno de voz/texto.
   */
  cancel: () => void;
}

function readStoredMute(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredMute(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // localStorage puede no estar disponible en private mode; no es crítico.
  }
}

export function useTtsPlayback(options: UseTtsPlaybackOptions): UseTtsPlaybackResult {
  const { bus, audioFactory } = options;
  const [muted, setMutedState] = useState<boolean>(() => options.muted ?? readStoredMute());

  // Override externo prevalece sobre localStorage si se pasa.
  useEffect(() => {
    if (options.muted !== undefined) setMutedState(options.muted);
  }, [options.muted]);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeStoredMute(next);
  }, []);

  // Refs estables para que los effects no se re-suscriban en cada render.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const stopCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      try {
        audio.pause();
        audio.src = '';
      } catch {
        // Silencioso: si pause/src lanzan, el audio ya estaba cerrado.
      }
    }
    audioRef.current = null;
    currentAudioIdRef.current = null;
  }, []);

  useEffect(() => {
    const unsubAudio = bus.on('tts:audio', (payload) => {
      // Si llega un audio nuevo y aún suena el anterior, lo cortamos
      // (el server normalmente cancela primero, pero por robustez).
      stopCurrent();

      currentAudioIdRef.current = payload.audioId;
      currentUserIdRef.current = payload.userId;

      if (mutedRef.current) {
        // No reproducimos pero desbloqueamos el estado del reducer.
        void bus.emit('tts:audio-ended', {
          userId: payload.userId,
          audioId: payload.audioId,
        });
        return;
      }

      const audio = audioFactory ? audioFactory() : new Audio();
      audioRef.current = audio;
      audio.src = payload.url;

      const finish = (): void => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          currentAudioIdRef.current = null;
        }
        void bus.emit('tts:audio-ended', {
          userId: payload.userId,
          audioId: payload.audioId,
        });
      };

      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener(
        'error',
        () => {
          // Fallo del browser al cargar/decodificar — desbloqueamos
          // el estado y dejamos al usuario continuar.
          finish();
        },
        { once: true },
      );

      audio.play().catch(() => {
        // Algunos navegadores requieren user gesture antes de play();
        // en ese caso, asumimos audio fallido y desbloqueamos.
        finish();
      });
    });

    const unsubCancel = bus.on('tts:cancel', (payload) => {
      if (currentAudioIdRef.current !== payload.audioId) return;
      const userId = currentUserIdRef.current ?? payload.userId;
      stopCurrent();
      void bus.emit('tts:audio-ended', { userId, audioId: payload.audioId });
    });

    return () => {
      unsubAudio();
      unsubCancel();
      stopCurrent();
    };
  }, [bus, audioFactory, stopCurrent]);

  const cancel = useCallback(() => {
    const audioId = currentAudioIdRef.current;
    if (audioId === null) return;
    const userId = currentUserIdRef.current ?? '';
    void bus.emit('tts:cancel', { audioId, userId });
  }, [bus]);

  return { muted, setMuted, cancel };
}
