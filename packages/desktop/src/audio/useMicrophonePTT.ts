/**
 * Hook de push-to-talk para capturar audio del micro y mandarlo al
 * microservicio Whisper por WebSocket.
 *
 * Ciclo de un turno:
 *
 *   keydown(activationKey)
 *     → getUserMedia; con el micro concedido se empieza a abrir el WS y,
 *       a la vez, AudioContext({ sampleRate: 16000 }) y worklet.
 *     → bus.emit('stt:listening') en cuanto el micro captura
 *     → chunks PCM Int16 LE → cliente de Whisper (binario)
 *     → partial JSON del server → bus.emit('stt:partial')
 *   keyup(activationKey)
 *     → se pide al worklet lo que tenga a medias (el final de la frase)
 *     → se pide el final; espera `transcribed`.
 *     → bus.emit('stt:transcribed')
 *     → libera AudioContext, MediaStream, WS.
 *
 * Decisiones:
 *
 * - **El micro no espera a Whisper** (R-143): se captura desde que el micro
 *   está listo, aunque el WS siga abriendo. El cliente guarda esos primeros
 *   trozos y los envía al abrir; si no, se perdía la primera sílaba.
 * - **A Whisper se le llama con el micro ya concedido**: el servicio cierra
 *   una sesión que pasa 15 s sin tráfico, y contestar al diálogo de permiso
 *   (o un micro Bluetooth que despierta) puede tardar más que eso.
 * - **Nada se queda colgado** (R-322): si Whisper no abre o no devuelve la
 *   transcripción a tiempo, el cliente falla y aquí se suelta el micro.
 *   Soltar la tecla antes de que el micro esté listo cancela el turno, y
 *   desmontar la pantalla también: el micro que llegue después se suelta.
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
import { describeMicError, describeSttFailure } from './mic-error-text.js';
import { WhisperSttClient } from './whisper-stt-client.js';
import workletUrl from './pcm-capture-processor.js?url';

const TARGET_SAMPLE_RATE = 16_000;

/**
 * Cuánto se espera, al soltar, a que el worklet entregue lo que tenía a
 * medias. Contesta en el siguiente paso de audio (milisegundos); el plazo es
 * para no quedarse esperando a uno que no conteste.
 */
export const FLUSH_TIMEOUT_MS = 150;

/** El aviso del worklet de que ya entregó lo pendiente. */
function isFlushedMessage(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'flushed'
  );
}

export type MicrophonePTTState =
  'idle' | 'requesting' | 'recording' | 'finalizing' | 'error' | 'unsupported';

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
  /** Qué pasó y qué hacer, en español, si `state === 'error'`. */
  error: string | null;
  /**
   * Arranca un turno programáticamente (sin esperar el keydown). Útil
   * para botones de micro o para tests.
   */
  start: () => Promise<void>;
  /** Detiene el turno en curso (equivalente al keyup). */
  stop: () => Promise<void>;
  /**
   * Corta la captura en curso SIN pedir la transcripción final: no se emite
   * `stt:transcribed`. Para cuando se pierde la conexión con el core-host y
   * un mensaje de voz ya no tendría a dónde ir. No hace nada si no se graba.
   */
  cancel: () => void;
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
  /**
   * El turno en curso. Cada `start()` crea uno; lo que llega tarde de un turno
   * que ya se canceló o falló (el permiso del micro, el WS) lo mira y se retira.
   */
  const turnRef = useRef<{ over: boolean } | null>(null);
  /** Da por terminada la espera al worklet de `flushWorklet`, si hay una. */
  const flushWaiterRef = useRef<(() => void) | null>(null);

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
    // El turno acaba aquí también para lo que aún no ha llegado (el permiso
    // del micro, la carga del worklet): al llegar lo ve terminado y se suelta.
    if (turnRef.current !== null) turnRef.current.over = true;
    // Quien esperaba al worklet no tiene ya nada que esperar.
    flushWaiterRef.current?.();

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

    // Cierra también el WS si el turno seguía vivo (desmontaje a mitad).
    clientRef.current?.abort();
    clientRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (stateRef.current === 'unsupported') return;
    if (stateRef.current !== 'idle' && stateRef.current !== 'error') return;
    setError(null);
    setStateAndRef('requesting');

    const turn = { over: false };
    turnRef.current = turn;

    /** El turno falló: se dice por qué y se suelta todo. Solo la primera vez. */
    const fail = (message: string): void => {
      if (turn.over) return;
      turn.over = true;
      setError(message);
      setStateAndRef('error');
      teardown();
    };

    let mediaStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    /** Suelta lo que este arranque llegó a abrir y aún no estaba en los refs. */
    const releaseLocal = (): void => {
      mediaStream?.getTracks().forEach((t) => {
        t.stop();
      });
      audioContext?.close().catch(() => undefined);
    };
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      // Mientras se pedía el micro, el turno se canceló o la pantalla se fue.
      if (turn.over) {
        releaseLocal();
        return;
      }

      const client = new WhisperSttClient({
        url: serviceUrl,
        onPartial: (text) => {
          void bus.emit('stt:partial', { text, userId });
        },
        onFinal: (text) => {
          void bus.emit('stt:transcribed', { text, userId, isFinal: true });
        },
        onError: (_reason, code) => {
          fail(describeSttFailure(code));
        },
      });
      clientRef.current = client;
      // El WS se abre mientras se prepara la captura; no se espera aquí. Lo
      // que se diga antes de que abra lo guarda el cliente.
      client.open().catch((err: unknown) => {
        fail(describeMicError(err));
      });

      // El browser podría rechazar el sampleRate solicitado y devolver otro;
      // el worklet leerá su `sampleRate` global real y decimará si hace falta.
      const ContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (ContextCtor === undefined) {
        throw new Error('AudioContext no disponible en este navegador');
      }
      audioContext = new ContextCtor({ sampleRate: TARGET_SAMPLE_RATE });
      await audioContext.audioWorklet.addModule(workletUrl);
      // Mientras cargaba el worklet, el turno se canceló o Whisper falló.
      if (turn.over) {
        releaseLocal();
        return;
      }
      mediaStreamRef.current = mediaStream;
      audioContextRef.current = audioContext;

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

      // Chunks PCM Int16 LE del worklet al cliente, que los envía o, si el WS
      // sigue abriendo, los guarda hasta que abra.
      worklet.port.onmessage = (event) => {
        const data: unknown = event.data;
        if (data instanceof ArrayBuffer) {
          client.sendChunk(data);
          return;
        }
        if (isFlushedMessage(data)) flushWaiterRef.current?.();
      };

      source.connect(worklet);
      // El worklet no produce salida audio; no conectamos a destination.

      void bus.emit('stt:listening', { userId });
      setStateAndRef('recording');
    } catch (err) {
      if (turn.over) {
        releaseLocal();
        return;
      }
      // El stream puede no estar aún en los refs: se suelta aquí también.
      releaseLocal();
      fail(describeMicError(err));
    }
  }, [bus, serviceUrl, userId, setStateAndRef, teardown]);

  /**
   * Pide al worklet lo que tenga a medias y espera a que lo entregue. Lo
   * entregado llega por su puerto como un trozo más y sale hacia Whisper.
   * Nunca rechaza: si el worklet no contesta, se sigue al vencer el plazo.
   */
  const flushWorklet = useCallback((): Promise<void> => {
    const worklet = workletNodeRef.current;
    if (worklet === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        flushWaiterRef.current = null;
        resolve();
      };
      const timer = setTimeout(() => {
        // Lo que entregue después de esto llega con el final ya pedido y el
        // cliente de Whisper lo descarta: que al menos quede dicho.
        console.warn(
          '[Micro] el worklet no entregó a tiempo lo que tenía pendiente; puede faltar el final de la frase',
        );
        done();
      }, FLUSH_TIMEOUT_MS);
      flushWaiterRef.current = done;
      try {
        worklet.port.postMessage({ type: 'flush' });
      } catch {
        // Puerto cerrado o inservible: no hay nada que esperar.
        done();
      }
    });
  }, []);

  /** Corta el turno en curso sin pedir transcripción y vuelve a reposo. */
  const cancelTurn = useCallback((): void => {
    const turn = turnRef.current;
    if (turn !== null) turn.over = true;
    sourceNodeRef.current?.disconnect();
    // `teardown` aborta el cliente: cierra el WS sin emitir `onFinal`, así
    // que nada llega al bus como transcripción.
    teardown();
    setStateAndRef('idle');
  }, [setStateAndRef, teardown]);

  const stop = useCallback(async (): Promise<void> => {
    // Se soltó antes de que el micro estuviera listo: no hay nada que transcribir.
    if (stateRef.current === 'requesting') {
      cancelTurn();
      return;
    }
    if (stateRef.current !== 'recording') return;
    setStateAndRef('finalizing');
    const turn = turnRef.current;
    const client = clientRef.current;
    try {
      // El worklet junta 250 ms antes de entregar: lo que tiene a medias es
      // el final de la frase, y tiene que salir antes que el «stop». Se pide
      // con la entrada aún conectada: cortándola antes, lo último que entró
      // podía quedarse fuera.
      await flushWorklet();
      // Cortar la entrada de audio al worklet antes de pedir el final
      // — evita que sigan llegando chunks tras el stop.
      sourceNodeRef.current?.disconnect();
      // Si el WS aún está abriendo, el cliente envía lo guardado y después el stop.
      await client?.stop();
      if (turn !== null && !turn.over) {
        turn.over = true;
        setStateAndRef('idle');
      }
    } catch (err) {
      // Si el fallo ya se contó (por `onError` o por el rechazo de `open`), no se repite.
      if (turn !== null && !turn.over) {
        turn.over = true;
        setError(describeMicError(err));
        setStateAndRef('error');
      }
    } finally {
      // Solo lo de este turno: si ya hubiera otro en marcha, sus recursos no se tocan.
      if (turnRef.current === turn) teardown();
    }
  }, [cancelTurn, flushWorklet, setStateAndRef, teardown]);

  const cancel = useCallback((): void => {
    if (stateRef.current !== 'recording' && stateRef.current !== 'requesting') return;
    cancelTurn();
  }, [cancelTurn]);

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

  return { state, error, start, stop, cancel };
}
