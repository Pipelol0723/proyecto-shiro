/**
 * Motor Live2D como un candidato más del selector (ADR 0028 §3).
 *
 * No cambia nada de cómo se dibuja: la comprobación es la que ya hacía
 * `<Avatar>` (ADR 0021 §3) y el componente sigue siendo `Live2DCanvas`.
 *
 * Hiyori, el modelo de prueba, todavía no tiene manifiesto: su candidato lleva
 * la configuración de siempre. El ADR 0028 §2 prevé darle uno; queda para
 * cuando haya un modelo Live2D de Shiro.
 */

import { ensureCubismCore } from '../cubism-core';
import type { AvatarRuntimeConfig } from '../config';
import { isModelReachable } from '../model-loader';
import type {
  AvatarCandidate,
  AvatarEngineComponent,
  AvatarEngineDefinition,
  AvatarEngineProps,
} from './types';

export const LIVE2D_KIND = 'live2d';

export interface Live2DCandidate extends AvatarCandidate {
  readonly kind: typeof LIVE2D_KIND;
  readonly config: AvatarRuntimeConfig;
}

export function live2dCandidate(config: AvatarRuntimeConfig): Live2DCandidate {
  return { kind: LIVE2D_KIND, config };
}

function isLive2DCandidate(candidate: AvatarCandidate): candidate is Live2DCandidate {
  return candidate.kind === LIVE2D_KIND && 'config' in candidate;
}

export const live2dEngine: AvatarEngineDefinition = {
  kind: LIVE2D_KIND,

  async probe(candidate, signal) {
    if (!isLive2DCandidate(candidate)) return false;
    // 1. El modelo existe (un HEAD: sin descargar texturas).
    if (!(await isModelReachable(candidate.config.modelPath, signal))) return false;
    if (signal.aborted) return false;
    // 2. El Cubism Core está en `window` (se inyecta una sola vez).
    return ensureCubismCore(candidate.config.cubismCoreUrl);
  },

  async load(): Promise<AvatarEngineComponent> {
    // Solo ahora se importa el lienzo: `pixi-live2d-display` lanza al
    // evaluarse si el Cubism Core no está, y con un import estático se
    // llevaría por delante también el orbe.
    const { Live2DCanvas } = await import('../Live2DCanvas');
    return function Live2DEngine(props: AvatarEngineProps): JSX.Element | null {
      if (!isLive2DCandidate(props.candidate)) return null;
      return (
        <Live2DCanvas
          size={props.size}
          config={props.candidate.config}
          audioElement={props.audioElement}
          emotion={props.emotion}
          onLoadError={props.onLoadError}
        />
      );
    };
  },
};
