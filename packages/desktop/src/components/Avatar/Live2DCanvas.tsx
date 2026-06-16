/**
 * Live2DCanvas — monta un `PIXI.Application` con `pixi-live2d-display`
 * y renderiza el modelo Live2D dentro del `<Avatar>`.
 *
 * Pre-condición: el caller (`<Avatar>`) ya verificó que el Cubism Core
 * SDK cargó y que el `.model3.json` es alcanzable. Si la carga del
 * modelo dentro de PIXI fallase aún así (raro pero posible — texturas
 * 404, .moc3 corrupto), notificamos al caller via `onLoadError` y
 * dejamos el canvas vacío para que el `<Avatar>` levante el Orbe.
 *
 * Cap de fps: `app.ticker.maxFPS = config.maxFps` (default 30, ADR 0021 §4).
 *
 * **Lip-sync** (ADR 0021 §5): recibe el `<audio>` del TTS por props y,
 * vía `useLipSync`, mapea su amplitud al parámetro `ParamMouthOpenY` del
 * modelo cada frame. Las expresiones por emoción llegan en el PR #4.
 */

import { useCallback, useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { Application, Ticker } from 'pixi.js';
import { install as installUnsafeEvalShaders } from '@pixi/unsafe-eval';
// `pixi-live2d-display-lipsyncpatch` es el fork mantenido activamente
// que arregla bugs del original `pixi-live2d-display@0.5.0-beta` —
// principalmente el crash `Cannot read properties of undefined (reading '0')`
// en `CubismRenderer_WebGL.doDrawModel` con Cubism Core v5+ (SDK v5).
// Misma API pública, drop-in. Importamos el bundle Cubism 4 únicamente:
// el bundle por defecto carga también el plugin Cubism 2 que requiere
// `live2d.min.js`, que no incluimos. Hiyori y los modelos modernos son
// Cubism 4.
import { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4';
import { useLipSync } from './useLipSync';
import { useAvatarExpression } from './useAvatarExpression';
import type { Emotion } from '@proyecto-shiro/core';
import type { AvatarRuntimeConfig } from './config';
import styles from './Avatar.module.css';

// PixiJS genera shaders con `new Function()` (eval). La CSP del binario
// Tauri (`script-src 'self' 'wasm-unsafe-eval'`, sin `unsafe-eval`) lo
// bloquea en producción → `Application` lanzaba en systemCheck y el
// avatar caía al Orbe SOLO en la app instalada (en dev la CSP no se
// inyecta, por eso ahí funcionaba). `@pixi/unsafe-eval` reemplaza esos
// paths por shaders precompilados sin eval — la solución oficial de
// PixiJS para entornos con CSP estricta; así no aflojamos la CSP.
installUnsafeEvalShaders(PIXI);

// pixi-live2d-display espera que el Ticker de PIXI esté registrado
// globalmente como motor de animación del modelo. Sin esto el avatar
// queda estático (idle no corre). Es seguro llamarlo varias veces —
// la propia lib hace dedupe interno.
Live2DModel.registerTicker(Ticker);

/**
 * Acceso mínimo al parámetro de boca del modelo Cubism. Estructural a
 * propósito: desacopla el lip-sync de los tipos profundos de la lib.
 */
interface MouthControllable {
  internalModel: {
    coreModel: {
      setParameterValueById: (id: string, value: number) => void;
    };
  };
}

/** Parámetro estándar de apertura de boca en modelos Cubism. */
const PARAM_MOUTH_OPEN_Y = 'ParamMouthOpenY';

export interface Live2DCanvasProps {
  /** Tamaño cuadrado del canvas en px. */
  size: number;
  /** Config runtime (modelPath, maxFps, idleAnimation). */
  config: AvatarRuntimeConfig;
  /**
   * El `<audio>` del TTS para el lip-sync (ADR 0021 §5). `null` si no
   * suena nada o el cliente está muteado → la boca queda cerrada.
   */
  audioElement?: HTMLAudioElement | null;
  /** Emoción actual de Shiro, para la expresión facial (ADR 0021 §6). */
  emotion?: Emotion;
  /**
   * Notificado si la carga del modelo dentro de PIXI falla (típico:
   * texturas 404, formato del .moc3 incompatible). El caller debe
   * desmontar el canvas y caer al Orbe.
   */
  onLoadError?: (err: unknown) => void;
}

export function Live2DCanvas({
  size,
  config,
  audioElement = null,
  emotion = 'neutral',
  onLoadError,
}: Live2DCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Guardamos refs a la app y al modelo para limpiar en el unmount.
  const appRef = useRef<Application | null>(null);
  // Ref al modelo cargado para que el lip-sync escriba sin recrear el
  // canvas. `null` mientras el modelo no esté listo.
  const modelRef = useRef<MouthControllable | null>(null);

  // Escribe un parámetro arbitrario del modelo (no-op si aún no cargó).
  // Estable (useCallback []) — base del lip-sync y de las expresiones.
  const setParam = useCallback((id: string, value: number): void => {
    const model = modelRef.current;
    if (model === null) return;
    try {
      model.internalModel.coreModel.setParameterValueById(id, value);
    } catch {
      // Modelo sin ese parámetro (otro modelo): ignoramos en silencio.
    }
  }, []);

  // Apertura de boca para el lip-sync (estable para useLipSync).
  const setMouthOpen = useCallback(
    (value: number): void => {
      setParam(PARAM_MOUTH_OPEN_Y, value);
    },
    [setParam],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    let disposed = false;
    const app = new Application({
      width: size,
      height: size,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    appRef.current = app;
    app.ticker.maxFPS = config.maxFps;
    // `app.view` es `HTMLCanvasElement` en pixi.js v7.
    const canvas = app.view as unknown as HTMLCanvasElement;
    canvas.style.width = `${String(size)}px`;
    canvas.style.height = `${String(size)}px`;
    container.appendChild(canvas);

    void (async () => {
      try {
        const model = await Live2DModel.from(config.modelPath, {
          // `autoInteract` está deprecated en v0.5+ — la API moderna lo
          // separa en `autoHitTest` (clicks/hit areas) y `autoFocus`
          // (mirada que sigue al cursor). Ambos `false` por V1 — eye
          // tracking y click interactions están deferred en ADR 0021.
          autoHitTest: false,
          autoFocus: false,
          // `autoUpdate` SIEMPRE true: el modelo debe seguir
          // actualizándose cada frame para que el lip-sync se aplique al
          // mesh (el `coreModel.update` que hornea ParamMouthOpenY vive en
          // ese loop). Las animaciones idle se controlan por separado.
          autoUpdate: true,
          // Control de la animación idle: cuando está apagada apuntamos el
          // grupo idle a uno inexistente, así el modelo respira y parpadea
          // (managers aparte) pero NO reproduce las motions de cuerpo, que
          // tocan el parámetro de boca y enturbian la lectura del lip-sync.
          idleMotionGroup: config.idleAnimation ? undefined : '__shiro_no_idle__',
        });
        if (disposed) {
          model.destroy();
          return;
        }
        // Ajusta el modelo para que quepa centrado en el canvas.
        //
        // Los modelos Live2D son verticales (Hiyori ~1100x2200) y el
        // bounding box que reporta `model.width/height` incluye padding
        // interno para animaciones (brazos extendidos, pelo, etc.).
        // Usar `Math.min(width, height)` deja el cuerpo visible muy
        // pequeño y descentrado.
        //
        // Patrón: anchor al centro del modelo, escala al alto del
        // canvas con factor extra, posición central. El bounding box
        // del modelo incluye ~30-40% de padding alrededor del cuerpo
        // visible (espacio para manos extendidas, pelo agitándose,
        // etc.) — sin el factor, el avatar se ve diminuto. 1.18 lo
        // mantiene grande dentro del canvas de la pantalla principal,
        // pero deja margen para que no se recorten pelo ni pies.
        const FILL_FACTOR = 1.18;
        model.anchor.set(0.5, 0.5);
        model.scale.set((size / model.height) * FILL_FACTOR);
        model.x = size / 2;
        model.y = size / 2;
        app.stage.addChild(model);
        // Expone el modelo al lip-sync. Cast estructural: la lib tipa
        // `internalModel.coreModel.setParameterValueById`, pero lo
        // aislamos vía `MouthControllable` para no acoplarnos a su d.ts.
        modelRef.current = model as unknown as MouthControllable;
      } catch (err) {
        if (disposed) return;
        if (onLoadError !== undefined) onLoadError(err);
      }
    })();

    return () => {
      disposed = true;
      // `destroy({ removeView: true })` se encarga del canvas, ticker
      // y children. Defensivo: si `view` ya fue removido por React
      // (raro), capturamos el error y seguimos.
      try {
        app.destroy(true, { children: true, texture: true, baseTexture: true });
      } catch {
        // ignored
      }
      appRef.current = null;
      modelRef.current = null;
    };
    // Re-mount completo si cambia el modelPath o el tamaño — caso raro,
    // pero el efecto secundario (canvas recreado) es lo correcto.
  }, [size, config.modelPath, config.maxFps, config.idleAnimation, onLoadError]);

  // Lip-sync: mapea la amplitud del audio del TTS a la boca del modelo.
  // `audioElement` null (sin audio / muteado) → boca cerrada.
  useLipSync({ audioElement, setMouthOpen });

  // Expresión facial: interpola los parámetros del modelo hacia la
  // emoción actual de Shiro. Seam para `model.expression()` cuando llegue
  // un modelo con `.exp3.json` (ver `expression-map.ts`).
  useAvatarExpression({ emotion, setParam });

  return (
    <div
      ref={containerRef}
      className={styles.live2dCanvas}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
