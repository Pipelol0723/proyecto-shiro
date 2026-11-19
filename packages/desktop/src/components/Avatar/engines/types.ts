/**
 * Contrato de un motor del avatar (ADR 0028 §1 y §3, ADR 0035 §5).
 *
 * Tres piezas, y nada más en común entre motores tan distintos como capas,
 * Live2D o VRM:
 *
 * - **Candidato**: un modelo que se podría mostrar y con qué motor.
 * - **Definición del motor**: cómo saber si un candidato se puede montar
 *   (`probe`) y cómo traer el componente que lo dibuja (`load`).
 * - **Verbos**: lo único que un motor expone por dentro para moverse.
 */

import type { ComponentType } from 'react';
import type { Emotion } from '@proyecto-shiro/core';

/**
 * Un modelo que se podría mostrar. `kind` dice qué motor lo dibuja; cada motor
 * añade lo suyo (la configuración de Live2D, la URL del manifiesto…) y lo
 * reconoce con su propia guarda de tipo.
 */
export interface AvatarCandidate {
  readonly kind: string;
}

/** Lo que recibe el componente de cualquier motor. */
export interface AvatarEngineProps {
  candidate: AvatarCandidate;
  size: number;
  emotion: Emotion;
  /** El `<audio>` de la voz que suena, para mover la boca. `null` = nada suena. */
  audioElement: HTMLAudioElement | null;
  /**
   * El motor no pudo cargar el modelo, o dejó de poder pintarlo. El selector
   * lo desmonta y pasa al siguiente candidato.
   */
  onLoadError: (err: unknown) => void;
}

export type AvatarEngineComponent = ComponentType<AvatarEngineProps>;

export interface AvatarEngineDefinition {
  readonly kind: string;
  /**
   * ¿Se puede montar este candidato? Barato: no carga el motor ni el modelo
   * entero. Debe respetar `signal` (el selector la aborta al agotar el tiempo
   * o al desmontarse). Si lanza, cuenta como «no».
   */
  probe(candidate: AvatarCandidate, signal: AbortSignal): Promise<boolean>;
  /**
   * Trae el componente con un import dinámico, para que el código del motor
   * solo se cargue si se va a usar. Solo se llama tras un `probe` afirmativo.
   */
  load(): Promise<AvatarEngineComponent>;
}

/**
 * Los cinco verbos de un motor (ADR 0028 §1). Son internos: el componente del
 * motor traduce sus props a estas llamadas.
 *
 * Todavía nada los conecta con el selector: el traspaso de estado y el fundido
 * del cambio en caliente (ADR 0035 §5) llegan con AV-3, y pedirán una señal de
 * «listo» y un manejador del motor. Son añadidos, no un rediseño.
 */
export interface AvatarEngineVerbs {
  /** Ir hacia una expresión con nombre de Shiro (`idle`, `smirk`…). */
  setExpression(name: string): void;
  /** Abrir la boca, de 0 a 1; el valor viene del audio. */
  setMouthOpen(value: number): void;
  /** Parpadeo manual de 0 a 1; `null` lo deja en automático. */
  setBlink(value: number | null): void;
  /** Intensidad de las líneas de circuito; `null` deja la de la expresión. */
  setGlow(value: number | null): void;
  /**
   * Mirada, de −1 a 1 por eje (`x` positivo, derecha; `y` positivo, arriba).
   * `null` devuelve el mando a la expresión, y sin `y` vale 0: amplían el
   * ADR 0028, que solo definía `setLookAt(x, y)`.
   */
  setLookAt(x: number | null, y?: number): void;
}

/** Ciclo de vida de un motor que se puede cambiar en caliente (ADR 0035 §5). */
export interface AvatarEngineLifecycle {
  /** Suelta imágenes y lienzos. Después no pinta nada. */
  dispose(): void;
}
