/**
 * useAvatarExpression — anima la expresión facial del modelo Live2D hacia
 * la emoción actual de Shiro (ADR 0021 §6).
 *
 * La emoción llega por prop (la setea el reducer del cliente desde
 * `llm:responded { emotion }`, así que no hace falta escuchar el bus aquí).
 * Cada frame interpolamos los parámetros faciales (`FACE_PARAM_IDS`) desde su
 * valor actual hacia el objetivo de la emoción (`resolveFaceParams`) y los
 * escribimos vía el callback `setParam`. El suavizado da una transición
 * natural entre expresiones.
 *
 * **Desacople del modelo**: igual que `useLipSync`, el hook NO conoce el
 * tipo Live2D — recibe `setParam(id, value)` que `<Live2DCanvas>` implementa
 * sobre el `coreModel`. Así es testeable sin WebGL.
 *
 * **Seam para `model.expression()`** (modelo futuro con `.exp3.json`): este
 * hook puede sustituirse por uno que, al cambiar `emotion`, llame
 * `model.expression(EMOTION_EXPRESSION_NAME[emotion])` una vez (sin loop de
 * parámetros). El mapeo de nombres ya vive en `expression-map.ts`.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Emotion } from '@proyecto-shiro/core';
import { FACE_PARAM_IDS, resolveFaceParams } from './expression-map';

/** Suavizado por frame (lerp) hacia el objetivo. 0..1. */
const DEFAULT_SMOOTHING = 0.2;

export interface UseAvatarExpressionOptions {
  /** Emoción actual de Shiro (del reducer / `llm:responded`). */
  emotion: Emotion;
  /**
   * Escribe un parámetro del modelo. `null` mientras el modelo no esté
   * listo. `<Live2DCanvas>` lo conecta a
   * `model.internalModel.coreModel.setParameterValueById`.
   */
  setParam: ((id: string, value: number) => void) | null;
  /** Desactiva la animación de expresión sin desmontar (default true). */
  enabled?: boolean;
  /** Suavizado por frame (0 = sin moverse, 1 = instantáneo). Default 0.2. */
  smoothing?: number;
}

export function useAvatarExpression(options: UseAvatarExpressionOptions): void {
  const { emotion, setParam, enabled = true, smoothing = DEFAULT_SMOOTHING } = options;

  // Objetivo de la emoción actual (se recalcula solo al cambiar de emoción).
  const target = useMemo(() => resolveFaceParams(emotion), [emotion]);
  const targetRef = useRef(target);
  targetRef.current = target;

  // Valor interpolado actual de cada parámetro, persistente entre frames.
  const currentRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!enabled || setParam === null) return;

    let raf = 0;
    let active = true;

    const loop = (): void => {
      if (!active) return;
      const goal = targetRef.current;
      for (const id of FACE_PARAM_IDS) {
        const cur = currentRef.current[id] ?? 0;
        const next = cur + (goal[id] - cur) * smoothing;
        currentRef.current[id] = next;
        setParam(id, next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, [enabled, setParam, smoothing]);
}
