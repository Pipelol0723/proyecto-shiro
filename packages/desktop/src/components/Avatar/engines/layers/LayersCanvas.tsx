/**
 * LayersCanvas — el lienzo que dibuja un avatar por capas (ADR 0028 §4).
 *
 * Junta las tres piezas del motor: el cargador trae el modelo, el reproductor
 * sabe dibujarlo y este componente pone lo que falta, que es lo que depende
 * del navegador y de React:
 *
 * - **El bucle de animación**, con el mismo tope de fotogramas que Live2D
 *   (ADR 0021 §4). Es suyo, así que lo para a la vez que suelta el modelo.
 * - **Los verbos**: la emoción elige la expresión y el audio de la voz abre
 *   la boca, con el mismo `useLipSync` que usa Live2D.
 * - **«Reducir movimiento»** del sistema, también si cambia con la app abierta.
 *
 * Si el modelo no carga, o deja de poder pintarse, avisa por `onLoadError`
 * una sola vez y se queda quieto: el selector lo desmonta y pasa al siguiente
 * candidato. Al desmontarse cancela la carga y suelta las imágenes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Emotion } from '@proyecto-shiro/core';
import { useLipSync } from '../../useLipSync';
import styles from '../../Avatar.module.css';
import { loadLayers, type LoadedLayers } from './loader';
import { LayersPlayer } from './player';

/** Tope de fotogramas por segundo, el mismo que el avatar Live2D. */
export const MAX_FPS = 30;

/**
 * Paso de tiempo máximo. Al volver de una pestaña oculta el reloj da un salto
 * de minutos; así la animación sigue desde donde estaba en vez de saltar.
 */
const MAX_STEP_MS = 100;

/**
 * Margen al decidir si toca pintar: los fotogramas de una pantalla de 60 Hz
 * llegan cada 16,7 ms con algo de baile, y sin margen se perdería uno de cada
 * tres en vez de uno de cada dos.
 */
const FRAME_SLACK_MS = 1;

/** Píxeles reales por píxel de CSS que se usan como mucho: más no se nota y cuesta memoria. */
const MAX_PIXEL_RATIO = 2;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface LayersCanvasProps {
  /** URL del `avatar.manifest.json` del modelo. */
  manifestUrl: string;
  /** Lado del lienzo, en píxeles de CSS. La figura se ajusta dentro y se apoya abajo. */
  size: number;
  /** Emoción actual de Shiro; el manifiesto dice qué expresión le toca. */
  emotion?: Emotion;
  /** El `<audio>` de la voz, para mover la boca. `null` = nada suena. */
  audioElement?: HTMLAudioElement | null;
  /** El modelo no cargó o dejó de poder pintarse. Se llama una sola vez. */
  onLoadError?: (err: unknown) => void;
  /** Cómo se carga el modelo. Solo se cambia en los tests. */
  load?: (manifestUrl: string, signal: AbortSignal) => Promise<LoadedLayers>;
}

/**
 * Lo que se usa de `matchMedia`. Escuchar los cambios es opcional: los WebKit
 * anteriores a 14 no tienen `addEventListener` ahí, y entonces la preferencia
 * se lee una vez y ya.
 */
interface MotionPreference {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: 'change', listener: (event: { matches: boolean }) => void) => void;
}

function readMotionPreference(): MotionPreference | null {
  if (typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/** Ajusta el lienzo interno al tamaño pedido y a la densidad de la pantalla. */
function fitCanvas(canvas: HTMLCanvasElement, size: number): void {
  const density = window.devicePixelRatio;
  const ratio = Number.isFinite(density) ? Math.min(Math.max(density, 1), MAX_PIXEL_RATIO) : 1;
  // Un tamaño que no es un número, o no es positivo, deja el lienzo mínimo.
  const side = Number.isFinite(size) ? Math.max(1, Math.round(size * ratio)) : 1;
  // Asignar el tamaño borra el lienzo: solo cuando de verdad cambia.
  if (canvas.width !== side) canvas.width = side;
  if (canvas.height !== side) canvas.height = side;
}

export function LayersCanvas({
  manifestUrl,
  size,
  emotion = 'neutral',
  audioElement = null,
  onLoadError,
  load = loadLayers,
}: LayersCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<LayersPlayer | null>(null);
  // Qué modelo está ya pintado. Con otro manifiesto vuelve a «no listo» solo.
  const [paintedUrl, setPaintedUrl] = useState<string | null>(null);
  const ready = paintedUrl === manifestUrl;

  // Lo que cambia sin que haya que volver a cargar el modelo se lee de aquí.
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const emotionRef = useRef(emotion);
  emotionRef.current = emotion;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const controller = new AbortController();
    const media = readMotionPreference();
    let model: LoadedLayers | null = null;
    let player: LayersPlayer | null = null;
    let frame = 0;
    let stopped = false;

    const onMotionChange = (event: { matches: boolean }): void => {
      player?.setReducedMotion(event.matches);
    };

    /** Para el dibujo y suelta el modelo. Vale llamarlo más de una vez. */
    const stop = (): void => {
      stopped = true;
      cancelAnimationFrame(frame);
      media?.removeEventListener?.('change', onMotionChange);
      playerRef.current = null;
      player?.dispose();
      player = null;
      model?.release();
      model = null;
    };

    const fail = (err: unknown): void => {
      if (stopped) return;
      stop();
      console.warn(`[Avatar] el modelo ${manifestUrl} no se puede mostrar`, err);
      onLoadErrorRef.current?.(err);
    };

    void load(manifestUrl, controller.signal).then(
      (loaded) => {
        if (stopped) {
          // Llegó después de desmontar: ya no es de nadie.
          loaded.release();
          return;
        }
        model = loaded;
        try {
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('el navegador no da un contexto 2D');
          const current = new LayersPlayer(loaded.manifest, loaded.images, {
            reducedMotion: media?.matches ?? false,
          });
          player = current;
          playerRef.current = current;
          current.setEmotion(emotionRef.current);
          media?.addEventListener?.('change', onMotionChange);

          const frameMs = 1000 / MAX_FPS;
          let last: number | null = null;
          let painted = false;
          const tick = (now: number): void => {
            if (stopped) return;
            frame = requestAnimationFrame(tick);
            if (last !== null && now - last < frameMs - FRAME_SLACK_MS) return;
            const elapsed = last === null ? 0 : Math.min(now - last, MAX_STEP_MS);
            last = now;
            try {
              fitCanvas(canvas, sizeRef.current);
              current.update(elapsed);
              context.clearRect(0, 0, canvas.width, canvas.height);
              current.draw(context, 0, 0, canvas.width, canvas.height);
              if (!painted) {
                painted = true;
                setPaintedUrl(manifestUrl);
              }
            } catch (err) {
              fail(err);
            }
          };
          frame = requestAnimationFrame(tick);
        } catch (err) {
          fail(err);
        }
      },
      (err: unknown) => {
        // Una carga cancelada no es un fallo del modelo.
        if (!controller.signal.aborted) fail(err);
      },
    );

    return () => {
      controller.abort();
      stop();
    };
  }, [manifestUrl, load]);

  useEffect(() => {
    playerRef.current?.setEmotion(emotion);
  }, [emotion]);

  // Estable para `useLipSync`. Antes de cargar no hay a quién abrirle la boca.
  const setMouthOpen = useCallback((value: number): void => {
    playerRef.current?.setMouthOpen(value);
  }, []);
  useLipSync({ audioElement, setMouthOpen });

  return (
    <canvas
      ref={canvasRef}
      className={styles.layersCanvas}
      style={{ width: size, height: size }}
      data-ready={ready}
      aria-hidden="true"
    />
  );
}
