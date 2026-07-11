/**
 * useSelfDevStatus — escucha el progreso y el resultado de las sesiones de
 * self-improvement (ADR 0023) que el core-host emite (`selfdev:progress`,
 * `selfdev:done`) y expone un estado simple para el indicador del cliente.
 *
 * Espejo del patrón de `useToolApproval`. Como el orquestador garantiza **una
 * sesión a la vez** (guardia de concurrencia), alcanza con un solo `session`.
 * El `result` persiste hasta que el usuario lo descarta (para no perder el link
 * del PR) o hasta que arranca una sesión nueva.
 *
 * Las **aprobaciones** (arrancar sesión / crear PR) NO viven acá: las maneja el
 * `ToolApprovalModal` (usan `tool:requires-approval`). Este hook es solo
 * informativo, no acciona nada.
 */

import { useCallback, useState } from 'react';
import type { EventMap } from '@proyecto-shiro/core';
import { useBusEvent } from '../../use-bus';

export type SelfDevPhase = EventMap['selfdev:progress']['phase'];

export interface SelfDevSessionState {
  topic: string;
  phase: SelfDevPhase;
  message?: string;
}

export interface SelfDevResultState {
  topic: string;
  ok: boolean;
  prUrl?: string;
  branch?: string;
  reason?: string;
}

export interface UseSelfDevStatusResult {
  /** Sesión en curso, o `null` si no hay ninguna. */
  session: SelfDevSessionState | null;
  /** Último resultado terminado, hasta que se descarta o arranca otra sesión. */
  result: SelfDevResultState | null;
  /** Limpia el resultado mostrado. */
  dismiss: () => void;
}

export function useSelfDevStatus(): UseSelfDevStatusResult {
  const [session, setSession] = useState<SelfDevSessionState | null>(null);
  const [result, setResult] = useState<SelfDevResultState | null>(null);

  useBusEvent('selfdev:progress', (p) => {
    setSession({ topic: p.topic, phase: p.phase, message: p.message });
    setResult(null); // actividad nueva limpia el resultado anterior
  });

  useBusEvent('selfdev:done', (p) => {
    setSession(null);
    setResult({
      topic: p.topic,
      ok: p.ok,
      prUrl: p.prUrl,
      branch: p.branch,
      reason: p.reason,
    });
  });

  const dismiss = useCallback(() => {
    setResult(null);
  }, []);

  return { session, result, dismiss };
}
