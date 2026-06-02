/**
 * Hook de push-to-talk para capturar audio del micro y mandarlo al
 * microservicio Whisper por WebSocket.
 *
 * Ciclo de un turno:
 *
 *   keydown(activationKey)
 *     → getUserMedia, AudioContext({ sampleRate: 16000 }), worklet, WS abierto.
 *     → bus.emit('stt:listening')
 *     → chunks PCM Int16 LE → ws.send (binario)
 *     → partial JSON del server → bus.emit('stt:partial')
 *   keyup(activationKey)
 *     → ws.send({type:'stop'}); espera `transcribed`.
 *     → bus.emit('stt:transcribed')
 *     → libera AudioContext, MediaStream, WS.
 *
 * Decisiones:
 *
 * - **getUserMedia por turno**: pedir permiso una vez sí, pero
 *   liberar la `MediaStreamTrack` al soltar la tecla para que el browser
 *   apague el indicador de micro entre turnos. Cuesta ~100 ms al inicio
 *   del siguiente turno; a cambio gana privacidad visible.
 * - **AudioContext({ sampleRate: 16000 })**: el browser hace el resampleo
 *   con buenos filtros si lo soporta; el worklet hace decimación naive
 *   si no.
 * - **Suprimir cuando el foco está en un input/textarea**: nadie quiere
 *   que Space active el micro mientras está escribiendo.
 *
 * Ver ADR 0019, decisión 4 (push-to-talk como activación primaria).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IEventBus, EventMap } from '@proyecto-shiro/core';
import { WhisperSttClient } from './whisper-stt-client.js';
import workletUrl from './pcm-capture-processor.js?url';

const TARGET_SAMPLE_RATE = 16_000;

export type MicrophonePTTState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'finalizing'
  | 'error'
  | 'unsupported';

export interface UseMicrophonePTTOptions {
  /** EventBus del cliente — los eventos `stt:*` se publican aquí. */
  bus: IEventBus<EventMap>;
  /** Tecla que activa el PTT. Default `Space`. */
  activationKey?: string;
  /** URL del WS del microservicio. Default `ws://localhost:8765/stt`. */
  serviceUrl?: string;
  /** userId que se publica en `stt:transcribed`. */
  userId: string;
  /** Si `false`, el hook no escucha eventos del teclado. Útil para tests. */
  enabled?: boolean;
}

export interface UseMicrophonePTTResult {
  /** Estado actual de la captura. */
  state: MicrophonePTTState;
  /** Mensaje legible si `state === 'error'`. */
  error: string | null;
  /**
   * Arranca un turno programáticamente (sin esperar el keydown). Útil
   * para botones de micro o para tests.
   */
  start: () => Promise<void>;
  /** Detiene el turno en curso (equivalente al keyup). */
  stop: () => Promise<void>;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

function microphoneSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.AudioContext === 'function'
  );
}

export function useMicrophonePTT(options: UseMicrophonePTTOptions): UseMicrophonePTTResult {
  const {
    bus,
    activationKey = 'Space',
    serviceUrl = 'ws://localhost:8765/stt',
    userId,
    enabled = true,
  } = options;

  const [state, setState] = useState<MicrophonePTTState>(() =>
    microphoneSupported() ? 'idle' : 'unsupported',
  );
  const [error, setError] = useState<string | null>(null);

  // Refs (no causan re-render). El estado en `state` es solo para UI;
  // la lógica decide qué hacer leyendo los refs, que se actualizan
  // junto al state vía `setStateAndRef`.
  const stateRef = useRef<MicrophonePTTState>(state);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const clientRef = useRef<WhisperSttClient | null>(null);

  const setStateAndRef = useCallback((next: MicrophonePTTState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /**
   * Libera todos los recursos del turno: WS, worklet, source node,
   * AudioContext, MediaStreamTrack. Llamar siempre tras un turno
   * (éxito o error) — esto apaga el indicador del micro.
   */
  const teardown = useCallback(() => {
    workletNodeRef.current?.port.close();
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    mediaStreamRef.current = null;

    audioContextRef.current?.close().catch(() => {
      // ya cerrado o en estado inválido: no es relevante
    });
    audioContextRef.current = null;

    clientRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (stateRef.current === 'unsupported') return;
    if (stateRef.current !== 'idle' && stateRef.current !== 'error') return;
    setError(null);
    setStateAndRef('requesting');

    let mediaStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = mediaStream;

      // El browser podría rechazar el sampleRate solicitado y devolver otro;
      // el worklet leerá su `sampleRate` global real y decimará si hace falta.
      const ContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (ContextCtor === undefined) {
        throw new Error('AudioContext no disponible en este navegador');
      }
      audioContext = new ContextCtor({ sampleRate: TARGET_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule(workletUrl);

      const source = audioContext.createMediaStreamSource(mediaStream);
      sourceNodeRef.current = source;
      const worklet = new AudioWorkletNode(audioContext, 'pcm-capture-processor', {
        processorOptions: {
          targetSampleRate: TARGET_SAMPLE_RATE,
          sourceSampleRate: audioContext.sampleRate,
        },
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      workletNodeRef.current = worklet;

      // Cliente WS — se conecta antes de empezar a enviar chunks.
      const client = new WhisperSttClient({
        url: serviceUrl,
        onPartial: (text) => {
          void bus.emit('stt:partial', { text, userId });
        },
        onFinal: (text) => {
          void bus.emit('stt:transcribed', { text, userId, isFinal: true });
        },
        onError: (reason) => {
          setError(reason);
          setStateAndRef('error');
          teardown();
        },
      });
      clientRef.current = client;
      await client.open();

      // Recibir chunks PCM Int16 LE del worklet y reenviarlos al WS.
      worklet.port.onmessage = (event) => {
        if (!(event.data instanceof ArrayBuffer)) return;
        client.sendChunk(event.data);
      };

      source.connect(worklet);
      // El worklet no produce salida audio; no conectamos a destination.

      void bus.emit('stt:listening', { userId });
      setStateAndRef('recording');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setError(reason);
      setStateAndRef('error');
      teardown();
    }
  }, [bus, serviceUrl, userId, setStateAndRef, teardown]);

  const stop = useCallback(async (): Promise<void> => {
    if (stateRef.current !== 'recording') return;
    setStateAndRef('finalizing');
    const client = clientRef.current;
    try {
      // Cortar la entrada de audio al worklet antes de pedir el final
      // — evita que sigan llegando chunks tras el stop.
      sourceNodeRef.current?.disconnect();
      await client?.stop();
      setStateAndRef('idle');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setError(reason);
      setStateAndRef('error');
    } finally {
      teardown();
    }
  }, [setStateAndRef, teardown]);

  // Listeners de teclado: keydown/keyup de la tecla configurada. Ignora
  // si el foco está en un input/textarea (espacio sirve para escribir).
  useEffect(() => {
    if (!enabled) return;
    if (state === 'unsupported') return;

    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== activationKey) return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      void start();
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code !== activationKey) return;
      if (isTypingTarget(e.target)) return;
      void stop();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activationKey, enabled, start, state, stop]);

  // Limpieza si el componente se desmonta a mitad de turno.
  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return { state, error, start, stop };
}
