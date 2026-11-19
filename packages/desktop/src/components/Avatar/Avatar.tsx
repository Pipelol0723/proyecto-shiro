/**
 * Avatar — elige qué motor dibuja a Shiro y cae al Orbe si ninguno puede.
 *
 * Selector por candidatos (ADR 0028 §3): recibe una lista ordenada de modelos
 * y monta el primero que esté disponible. Cada motor aporta su comprobación
 * (`probe`), con un tiempo límite, y su componente se importa solo si se va a
 * usar. El Orbe (ADR 0009) es siempre el último recurso y nunca falla.
 *
 * La lista por defecto es Live2D y, después, la chibi por capas (el orden del
 * ADR 0028 §3). Live2D conserva su comprobación de siempre (ADR 0021 §3): el
 * modelo responde a un HEAD y el Cubism Core está cargado. La chibi comprueba
 * que su manifiesto existe y es válido. Con la chibi instalada y sin el modelo
 * Live2D, sale la chibi.
 *
 * **Mientras se comprueba, Orbe.** Así no hay parpadeo: si un candidato
 * resulta disponible se cambia al motor; si no, no pasa nada.
 *
 * **Si el motor falla después de montado** (avisa por `onLoadError`, o lanza
 * al pintar y lo recoge el `ErrorBoundary`), se desmonta y se sigue por el
 * siguiente candidato; al final, el Orbe. Un motor que lanza en pleno render
 * no puede llevarse la app entera a blanco.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Orb } from '../Orb';
import { ErrorBoundary } from '../ErrorBoundary';
import { AVATAR_CONFIG, CHIBI_MANIFEST_URL, type AvatarRuntimeConfig } from './config';
import { layersCandidate, layersEngine } from './engines/layers/engine';
import { live2dCandidate, live2dEngine } from './engines/live2d';
import { selectEngine, type AvatarSelection } from './engines/select';
import type { AvatarCandidate, AvatarEngineDefinition } from './engines/types';
import type { AvatarProps } from './types';
import styles from './Avatar.module.css';

/** Motores que conoce el cliente. Añadir uno es añadirlo aquí. */
const DEFAULT_ENGINES: readonly AvatarEngineDefinition[] = [live2dEngine, layersEngine];

export interface AvatarComponentProps extends AvatarProps {
  /**
   * Configuración del candidato Live2D por defecto (modelPath, maxFps, etc.).
   * Default `AVATAR_CONFIG`. Se ignora si se pasa `candidates`.
   */
  config?: AvatarRuntimeConfig;
  /**
   * Modelos a probar, en orden. Por defecto, el Live2D de `config` y la chibi
   * por capas. Se compara por contenido: pasar una lista nueva con lo mismo no
   * reinicia nada.
   */
  candidates?: readonly AvatarCandidate[];
  /** Motores disponibles. Debe ser una lista estable; por defecto, los del cliente. */
  engines?: readonly AvatarEngineDefinition[];
}

export function Avatar(props: AvatarComponentProps): JSX.Element {
  const { config = AVATAR_CONFIG, candidates: given } = props;
  const candidates = useMemo(
    () => given ?? [live2dCandidate(config), layersCandidate(CHIBI_MANIFEST_URL)],
    [given, config],
  );
  // Una lista distinta es otro avatar: se empieza de cero. La clave es el
  // contenido, no la identidad, para que una lista escrita en línea no
  // reinicie la selección en cada render.
  //
  // Provisional: desmontar y volver al Orbe es lo contrario de lo que pide el
  // cambio en caliente (ADR 0035 §5: el modelo viejo sigue pintando mientras
  // carga el nuevo). Esta `key` desaparece con AV-3.
  return <AvatarStage key={candidatesKey(candidates)} {...props} candidates={candidates} />;
}

/** Los candidatos son datos planos; si alguno no se puede serializar, vale la lista entera. */
function candidatesKey(candidates: readonly AvatarCandidate[]): string {
  try {
    return JSON.stringify(candidates);
  } catch {
    return `sin-clave-${String(candidates.length)}`;
  }
}

interface SelectionState {
  selection: AvatarSelection | null;
  /** Primer candidato por comprobar: avanza cuando el motor montado falla. */
  from: number;
}

function AvatarStage(
  props: AvatarComponentProps & { candidates: readonly AvatarCandidate[] },
): JSX.Element {
  const {
    emotion = 'neutral',
    speaking = false,
    listening = false,
    thinking = false,
    size = 280,
    audioElement = null,
    candidates,
    engines = DEFAULT_ENGINES,
  } = props;

  const [{ selection, from }, setState] = useState<SelectionState>({ selection: null, from: 0 });
  // El contenido de `candidates` no cambia mientras vive este componente (su
  // `key` es ese contenido); el ref evita depender de su identidad.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  useEffect(() => {
    const controller = new AbortController();
    void selectEngine(candidatesRef.current, engines, { signal: controller.signal, from }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, selection: result }));
      },
    );
    return () => {
      // Cancela la comprobación en curso: ni monta nada ni deja peticiones colgando.
      controller.abort();
    };
  }, [engines, from]);

  // El motor montado falló: fuera, y a seguir por el siguiente candidato.
  //
  // El aviso va ligado al candidato que lo recibe: si un motor ya desmontado
  // avisa tarde, no tumba al que está montado ahora. Y es la misma función
  // mientras dure la selección: Live2DCanvas la tiene entre las dependencias
  // de su efecto, y una nueva en cada render reconstruiría el lienzo.
  const mountedIndex = selection?.index;
  const handleEngineFailure = useMemo(
    () => (): void => {
      if (mountedIndex === undefined) return;
      setState((current) =>
        current.selection?.index === mountedIndex
          ? { selection: null, from: mountedIndex + 1 }
          : current,
      );
    },
    [mountedIndex],
  );

  const orb = (
    <Orb
      emotion={emotion}
      speaking={speaking}
      listening={listening}
      thinking={thinking}
      size={size}
    />
  );

  if (selection !== null) {
    const { candidate, Component, index } = selection;
    return (
      <div className={styles.avatarWrap} data-emotion={emotion} data-render={candidate.kind}>
        <ErrorBoundary
          key={index}
          fallback={orb}
          onError={(err) => {
            console.warn(`[Avatar] el motor «${candidate.kind}» falló al pintar`, err);
            handleEngineFailure();
          }}
        >
          <Component
            candidate={candidate}
            size={size}
            emotion={emotion}
            audioElement={audioElement}
            onLoadError={handleEngineFailure}
          />
        </ErrorBoundary>
      </div>
    );
  }

  // Comprobando, o sin ningún candidato disponible: Orbe.
  return (
    <div className={styles.avatarWrap} data-emotion={emotion} data-render="orb">
      {orb}
    </div>
  );
}
