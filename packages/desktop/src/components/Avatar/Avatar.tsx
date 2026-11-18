/**
 * Avatar — elige qué motor dibuja a Shiro y cae al Orbe si ninguno puede.
 *
 * Selector por candidatos (ADR 0028 §3): recibe una lista ordenada de modelos
 * y monta el primero que esté disponible. Cada motor aporta su comprobación
 * (`probe`), con un tiempo límite, y su componente se importa solo si se va a
 * usar. El Orbe (ADR 0009) es siempre el último recurso y nunca falla.
 *
 * Hoy la lista por defecto tiene un solo candidato, Live2D, con la misma
 * comprobación de siempre (ADR 0021 §3): el modelo responde a un HEAD y el
 * Cubism Core está cargado.
 *
 * **Mientras se comprueba, Orbe.** Así no hay parpadeo: si un candidato
 * resulta disponible se cambia al motor; si no, no pasa nada.
 *
 * **Si el motor falla después de montado** (avisa por `onLoadError`, o lanza
 * al pintar y lo recoge el `ErrorBoundary`), se desmonta y se sigue por el
 * siguiente candidato; al final, el Orbe. Un motor que lanza en pleno render
 * no puede llevarse la app entera a blanco.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Orb } from '../Orb';
import { ErrorBoundary } from '../ErrorBoundary';
import { AVATAR_CONFIG, type AvatarRuntimeConfig } from './config';
import { live2dCandidate, live2dEngine } from './engines/live2d';
import { selectEngine, type AvatarSelection } from './engines/select';
import type { AvatarCandidate, AvatarEngineDefinition } from './engines/types';
import type { AvatarProps } from './types';
import styles from './Avatar.module.css';

/** Motores que conoce el cliente. Añadir uno es añadirlo aquí. */
const DEFAULT_ENGINES: readonly AvatarEngineDefinition[] = [live2dEngine];

export interface AvatarComponentProps extends AvatarProps {
  /**
   * Configuración del candidato Live2D por defecto (modelPath, maxFps, etc.).
   * Default `AVATAR_CONFIG`. Se ignora si se pasa `candidates`.
   */
  config?: AvatarRuntimeConfig;
  /**
   * Modelos a probar, en orden. Por defecto, solo el Live2D de `config`. Se
   * compara por contenido: pasar una lista nueva con lo mismo no reinicia nada.
   */
  candidates?: readonly AvatarCandidate[];
  /** Motores disponibles. Debe ser una lista estable; por defecto, los del cliente. */
  engines?: readonly AvatarEngineDefinition[];
}

export function Avatar(props: AvatarComponentProps): JSX.Element {
  const { config = AVATAR_CONFIG, candidates: given } = props;
  const candidates = useMemo(() => given ?? [live2dCandidate(config)], [given, config]);
  // Una lista distinta es otro avatar: se empieza de cero. La clave es el
  // contenido, no la identidad, para que una lista escrita en línea no
  // reinicie la selección en cada render.
  return <AvatarStage key={JSON.stringify(candidates)} {...props} candidates={candidates} />;
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
  const handleEngineFailure = useCallback((): void => {
    setState((current) =>
      current.selection === null ? current : { selection: null, from: current.selection.index + 1 },
    );
  }, []);

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
