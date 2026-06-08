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
  /**
   * El `HTMLAudioElement` que está reproduciendo el turno actual, o
   * `null` si no hay audio sonando (o el cliente está muteado). El
   * avatar lo usa para el lip-sync: lo conecta a un `AnalyserNode` y
   * mapea la amplitud a `ParamMouthOpenY` (ADR 0021 §5). Es `null`
   * cuando `muted` porque entonces no se crea elemento — la boca queda
   * cerrada, que es el comportamiento esperado.
   */
  audioElement: HTMLAudioElement | null;
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
  // Elemento que suena ahora — expuesto para el lip-sync del avatar.
  // State (no ref) a propósito: el avatar es un consumidor React que
  // necesita re-renderizar cuando aparece/desaparece el audio.
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

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
  // `audioFactory` en ref: la suscripción del effect NO debe recrearse
  // cuando el caller pasa un factory inline (identidad nueva cada render).
  // Sin esto, exponer `audioElement` —que provoca re-render— tumbaría y
  // re-suscribiría el audio en curso (su cleanup haría `audio.src=''`).
  const audioFactoryRef = useRef(audioFactory);
  audioFactoryRef.current = audioFactory;

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
    setAudioElement(null);
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

      const factory = audioFactoryRef.current;
      const audio = factory ? factory() : new Audio();
      audioRef.current = audio;
      // CORS: el audio se sirve desde el core-host (otro origen/puerto)
      // con `Access-Control-Allow-Origin: *` (ADR 0020). Sin
      // `crossOrigin='anonymous'` el `MediaElementAudioSourceNode` del
      // lip-sync queda "tainted" y el AnalyserNode devuelve solo ceros
      // → la boca no se movería. Debe fijarse ANTES de asignar `src`.
      audio.crossOrigin = 'anonymous';
      audio.src = payload.url;
      // Expone el elemento para que el avatar arranque el lip-sync.
      setAudioElement(audio);

      const finish = (): void => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          currentAudioIdRef.current = null;
          setAudioElement(null);
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
  }, [bus, stopCurrent]);

  const cancel = useCallback(() => {
    const audioId = currentAudioIdRef.current;
    if (audioId === null) return;
    const userId = currentUserIdRef.current ?? '';
    void bus.emit('tts:cancel', { audioId, userId });
  }, [bus]);

  return { muted, setMuted, cancel, audioElement };
}
