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
 * **No expone refs al modelo** todavía. La interacción real
 * (`setExpression`, lip-sync, etc.) llega en los próximos PRs del
 * hito; este PR solo monta y renderiza.
 */

import { useEffect, useRef } from 'react';
import { Application, Ticker } from 'pixi.js';
// `pixi-live2d-display-lipsyncpatch` es el fork mantenido activamente
// que arregla bugs del original `pixi-live2d-display@0.5.0-beta` —
// principalmente el crash `Cannot read properties of undefined (reading '0')`
// en `CubismRenderer_WebGL.doDrawModel` con Cubism Core v5+ (SDK v5).
// Misma API pública, drop-in. Importamos el bundle Cubism 4 únicamente:
// el bundle por defecto carga también el plugin Cubism 2 que requiere
// `live2d.min.js`, que no incluimos. Hiyori y los modelos modernos son
// Cubism 4.
import { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4';
import type { AvatarRuntimeConfig } from './config';
import styles from './Avatar.module.css';

// pixi-live2d-display espera que el Ticker de PIXI esté registrado
// globalmente como motor de animación del modelo. Sin esto el avatar
// queda estático (idle no corre). Es seguro llamarlo varias veces —
// la propia lib hace dedupe interno.
Live2DModel.registerTicker(Ticker);

export interface Live2DCanvasProps {
  /** Tamaño cuadrado del canvas en px. */
  size: number;
  /** Config runtime (modelPath, maxFps, idleAnimation). */
  config: AvatarRuntimeConfig;
  /**
   * Notificado si la carga del modelo dentro de PIXI falla (típico:
   * texturas 404, formato del .moc3 incompatible). El caller debe
   * desmontar el canvas y caer al Orbe.
   */
  onLoadError?: (err: unknown) => void;
}

export function Live2DCanvas({ size, config, onLoadError }: Live2DCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Guardamos refs a la app y al modelo para limpiar en el unmount.
  const appRef = useRef<Application | null>(null);

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
          autoUpdate: config.idleAnimation,
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
    };
    // Re-mount completo si cambia el modelPath o el tamaño — caso raro,
    // pero el efecto secundario (canvas recreado) es lo correcto.
  }, [size, config.modelPath, config.maxFps, config.idleAnimation, onLoadError]);

  return (
    <div
      ref={containerRef}
      className={styles.live2dCanvas}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
