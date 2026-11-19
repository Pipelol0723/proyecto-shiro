/**
 * Motor de capas como candidato del selector (ADR 0028 §3 y §4).
 *
 * Un candidato de este motor es la URL de un `avatar.manifest.json` de tipo
 * `sprite-layers`. La comprobación baja ese manifiesto y lo valida: es barata
 * (unos pocos KB) y basta para saber si hay modelo. Las imágenes las trae
 * después el componente; si falta alguna, avisa y el selector pasa al
 * siguiente candidato.
 */

import type {
  AvatarCandidate,
  AvatarEngineComponent,
  AvatarEngineDefinition,
  AvatarEngineProps,
} from '../types';
import { LayersLoadError, fetchManifest } from './loader';
import { SPRITE_LAYERS_KIND } from './manifest';

export interface LayersCandidate extends AvatarCandidate {
  readonly kind: typeof SPRITE_LAYERS_KIND;
  readonly manifestUrl: string;
}

export function layersCandidate(manifestUrl: string): LayersCandidate {
  return { kind: SPRITE_LAYERS_KIND, manifestUrl };
}

function isLayersCandidate(candidate: AvatarCandidate): candidate is LayersCandidate {
  return (
    candidate.kind === SPRITE_LAYERS_KIND &&
    'manifestUrl' in candidate &&
    typeof candidate.manifestUrl === 'string'
  );
}

/**
 * El componente del motor, una vez cargado. Se guarda para devolver siempre el
 * mismo: si cambiara de identidad en cada carga, React desmontaría y volvería a
 * montar el modelo.
 */
let cachedComponent: AvatarEngineComponent | null = null;

export const layersEngine: AvatarEngineDefinition = {
  kind: SPRITE_LAYERS_KIND,

  async probe(candidate, signal) {
    if (!isLayersCandidate(candidate)) return false;
    try {
      await fetchManifest(candidate.manifestUrl, signal);
      return true;
    } catch (err) {
      // Que no haya modelo instalado es lo normal y no se dice. Con el
      // servidor de desarrollo eso puede llegar como «no es JSON»: cuando el
      // archivo no existe contesta con la página de la app. Un manifiesto que
      // sí está y no vale, en cambio, es un error de quien lo escribió.
      const worthSaying =
        err instanceof LayersLoadError && (err.reason === 'invalid' || err.reason === 'too-big');
      if (worthSaying) console.warn(`[Avatar] ${candidate.manifestUrl}: ${err.message}`);
      return false;
    }
  },

  async load(): Promise<AvatarEngineComponent> {
    if (cachedComponent !== null) return cachedComponent;
    // Import dinámico: el reproductor y el lienzo solo se cargan si hay modelo.
    const { LayersCanvas } = await import('./LayersCanvas');
    cachedComponent = function LayersEngine(props: AvatarEngineProps): JSX.Element | null {
      if (!isLayersCandidate(props.candidate)) return null;
      return (
        <LayersCanvas
          manifestUrl={props.candidate.manifestUrl}
          size={props.size}
          emotion={props.emotion}
          audioElement={props.audioElement}
          onLoadError={props.onLoadError}
        />
      );
    };
    return cachedComponent;
  },
};
