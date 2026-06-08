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
import { Live2DModel } from 'pixi-live2d-display';
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
          autoInteract: false,
          autoUpdate: config.idleAnimation,
        });
        if (disposed) {
          model.destroy();
          return;
        }
        // Ajusta el modelo para que quepa centrado en el canvas. Los
        // modelos del Cubism SDK suelen venir con dimensiones nativas
        // mayores que el canvas; calculamos el `scale` que lo hace
        // caber sin recortes y lo centramos.
        const scale = Math.min(size / model.width, size / model.height);
        model.scale.set(scale);
        model.x = (size - model.width * scale) / 2;
        model.y = (size - model.height * scale) / 2;
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
