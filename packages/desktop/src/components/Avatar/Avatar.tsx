/**
 * Avatar — wrapper que decide entre Live2D y Orbe (fallback).
 *
 * Lógica de decisión (ADR 0021 §3):
 *
 *   ¿Cubism Core JS cargado en `window`?
 *   ¿`<modelPath>` responde a HEAD con 200?
 *      sí → <Live2DCanvas>
 *      no/error → <Orb>
 *
 * El fallback es **automático** y silencioso: si la detección falla, el
 * Orbe (ADR 0009) se renderiza como antes, con las mismas props. El
 * companion sigue 100% funcional aunque el dev no haya descargado el SDK
 * + modelo todavía.
 *
 * **Estado inicial = Orbe**. Mientras la detección está en curso
 * (`pending`), mostramos el Orbe — así no hay flash visual. Si la
 * detección resuelve en disponible, swappeamos al Live2D; si resuelve
 * en no-disponible, no hacemos nada (seguimos con Orbe).
 *
 * **`onLoadError` del canvas**: si el `Live2DCanvas` falla al cargar el
 * modelo DESPUÉS de pasar la detección (texturas 404, formato corrupto),
 * lo desmontamos y volvemos al Orbe — el efecto es el mismo que un
 * fallback inicial.
 */

import { useEffect, useState } from 'react';
import { Orb } from '../Orb';
import { Live2DCanvas } from './Live2DCanvas';
import { ensureCubismCore } from './cubism-core';
import { isModelReachable } from './model-loader';
import { AVATAR_CONFIG, type AvatarRuntimeConfig } from './config';
import type { AvatarProps } from './types';
import styles from './Avatar.module.css';

type Live2DStatus = 'pending' | 'available' | 'unavailable';

export interface AvatarComponentProps extends AvatarProps {
  /**
   * Override de la config (modelPath, maxFps, etc.). Default
   * `AVATAR_CONFIG` (hardcoded en `config.ts`). Útil para tests y para
   * cuando llegue una fuente de config dinámica server-side.
   */
  config?: AvatarRuntimeConfig;
}

export function Avatar(props: AvatarComponentProps): JSX.Element {
  const {
    emotion = 'neutral',
    speaking = false,
    listening = false,
    thinking = false,
    size = 280,
    config = AVATAR_CONFIG,
  } = props;

  const [status, setStatus] = useState<Live2DStatus>('pending');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 1. Verifica que el modelo es alcanzable (HEAD). Cheap, sin
      //    descargar texturas. Si el dev no ha bajado los assets, este
      //    paso falla rápido y caemos al Orbe sin tocar PIXI.
      const reachable = await isModelReachable(config.modelPath);
      if (cancelled) return;
      if (!reachable) {
        setStatus('unavailable');
        return;
      }
      // 2. Asegura el Cubism Core en `window`. Inyecta el <script> una
      //    sola vez (cache interno).
      const coreLoaded = await ensureCubismCore(config.cubismCoreUrl);
      if (cancelled) return;
      setStatus(coreLoaded ? 'available' : 'unavailable');
    })();
    return () => {
      cancelled = true;
    };
  }, [config.modelPath, config.cubismCoreUrl]);

  // Tras un load-error a posteriori del canvas, lo tratamos como
  // unavailable y caemos al Orbe.
  function handleCanvasLoadError(): void {
    setStatus('unavailable');
  }

  if (status === 'available') {
    return (
      <div className={styles.avatarWrap} data-emotion={emotion} data-render="live2d">
        <Live2DCanvas size={size} config={config} onLoadError={handleCanvasLoadError} />
      </div>
    );
  }

  // `pending` y `unavailable` ambos renderizan Orbe — el cambio entre
  // pending → available swappea sin flash porque el Orbe ya está montado
  // y el canvas aparece al lado en su lugar.
  return (
    <div className={styles.avatarWrap} data-emotion={emotion} data-render="orb">
      <Orb
        emotion={emotion}
        speaking={speaking}
        listening={listening}
        thinking={thinking}
        size={size}
      />
    </div>
  );
}
