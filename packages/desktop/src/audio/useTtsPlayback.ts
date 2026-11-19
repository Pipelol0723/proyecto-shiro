/**
 * useTtsPlayback — reproduce los audios TTS que el core-host emite por
 * el bus (`tts:audio`) y emite `tts:audio-ended` al terminar. También
 * responde a `tts:cancel` parando el audio en curso.
 *
 * Diseñado para montarse **una sola vez**, en `AudioProvider` (encima del
 * switch de pantallas, para que la voz no se corte al navegar). Si lo
 * montas varias veces tendrás N reproducciones simultáneas — eco garantizado.
 *
 * Toggle mute persistido en `localStorage` con key
 * `shiro:tts:muted` para que cada dispositivo recuerde su preferencia
 * entre sesiones. El primer cliente conectado tiene mute=false; los
 * demás deberían ponerlo manualmente (la lógica de "elegir dispositivo
 * activo" es ADR futuro para multi-device — ver ADR 0020).
 *
 * El audio se pide al mismo core-host al que está conectado el bus
 * (`hostUrl`): `tts:audio` trae solo la ruta. Lo que no sea un audio de ese
 * servidor no se reproduce (ver `./audio-url.ts`).
 *
 * Errores de fetch o reproducción no rompen la UI: se loguean y se
 * emite `tts:audio-ended` para desbloquear el estado `speaking` del
 * reducer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import { DEFAULT_HOST_URL, resolveAudioUrl } from './audio-url.js';

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
  /**
   * URL del bus del core-host al que está conectado este cliente. De ella
   * sale el servidor al que se pide el audio. Por defecto, el bus local.
   */
  hostUrl?: string;
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
   * Corta en local el audio que suena, sin pasar por el bus: no emite
   * `tts:cancel` ni `tts:audio-ended`. Es el corte para cuando no hay
   * conexión (el transport rechazaría el envío y nadie lo escucharía).
   * Devuelve `true` si había un audio sonando y se cortó.
   */
  cutLocal: () => boolean;
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
  const { bus, audioFactory, hostUrl = DEFAULT_HOST_URL } = options;
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

  // Audios que cortamos nosotros (R-119). Al asignar `src = ''` el navegador
  // dispara `error` en el elemento; sin esta marca `finish` lo trataría como
  // un fallo y emitiría un `tts:audio-ended` espurio del audio que ya no suena.
  const cutAudiosRef = useRef(new WeakSet<HTMLAudioElement>());

  const stopCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      cutAudiosRef.current.add(audio);
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

      currentUserIdRef.current = payload.userId;

      if (mutedRef.current) {
        // No reproducimos pero desbloqueamos el estado del reducer. No queda
        // como audio en curso: su fin ya se emite aquí, y un `tts:cancel`
        // posterior lo emitiría otra vez.
        void bus.emit('tts:audio-ended', {
          userId: payload.userId,
          audioId: payload.audioId,
        });
        return;
      }

      const src = resolveAudioUrl(payload.url, hostUrl);
      if (src === null) {
        // No es un audio del servidor al que estamos conectados: no se
        // reproduce, y el turno no se queda «hablando».
        console.warn(`[Audio] se descarta un audio que no es de este servidor: ${payload.url}`);
        void bus.emit('tts:audio-ended', {
          userId: payload.userId,
          audioId: payload.audioId,
        });
        return;
      }

      const factory = audioFactoryRef.current;
      const audio = factory ? factory() : new Audio();
      audioRef.current = audio;
      currentAudioIdRef.current = payload.audioId;
      // CORS: el audio se sirve desde el core-host (otro origen/puerto), que
      // devuelve `Access-Control-Allow-Origin` a los orígenes permitidos
      // (ADR 0027, 2a). Sin
      // `crossOrigin='anonymous'` el `MediaElementAudioSourceNode` del
      // lip-sync queda "tainted" y el AnalyserNode devuelve solo ceros
      // → la boca no se movería. Debe fijarse ANTES de asignar `src`.
      audio.crossOrigin = 'anonymous';
      audio.src = src;
      // Expone el elemento para que el avatar arranque el lip-sync.
      setAudioElement(audio);

      // `error` y el rechazo de `play()` pueden llegar los dos para el mismo
      // audio: el fin se emite una sola vez.
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        // Un audio cortado no emite su fin: quien lo corta (`tts:cancel`)
        // emite el suyo cuando toca, y si lo reemplaza otro audio, el fin
        // del anterior llegaría al reducer cuando ya suena el nuevo.
        if (cutAudiosRef.current.has(audio)) return;
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

      // La voz ya se oye: el core-host apunta la latencia hasta aquí (P-16).
      // `playing` se repite tras cada pausa por falta de datos; cuenta la primera.
      let started = false;
      audio.addEventListener('playing', () => {
        // Un audio que ya cortamos no «empieza»: su aviso sería de otro turno.
        if (started || cutAudiosRef.current.has(audio)) return;
        started = true;
        void bus.emit('tts:audio-started', {
          audioId: payload.audioId,
          userId: payload.userId,
        });
      });
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
      // Si el provider se vuelve a montar con un audio sonando (Fast Refresh,
      // remontaje), el corte no emitiría su fin y el reducer se quedaría en
      // `speaking`. Un audio muteado o ya terminado no tiene `audioRef`.
      const audioId = currentAudioIdRef.current;
      const userId = currentUserIdRef.current;
      const wasPlaying = audioRef.current !== null && audioId !== null;
      stopCurrent();
      if (wasPlaying && audioId !== null) {
        void bus.emit('tts:audio-ended', { userId: userId ?? '', audioId });
      }
    };
  }, [bus, hostUrl, stopCurrent]);

  const cancel = useCallback(() => {
    const audioId = currentAudioIdRef.current;
    if (audioId === null) return;
    const userId = currentUserIdRef.current ?? '';
    void bus.emit('tts:cancel', { audioId, userId });
  }, [bus]);

  const cutLocal = useCallback((): boolean => {
    if (audioRef.current === null) return false;
    stopCurrent();
    return true;
  }, [stopCurrent]);

  return { muted, setMuted, cancel, cutLocal, audioElement };
}
