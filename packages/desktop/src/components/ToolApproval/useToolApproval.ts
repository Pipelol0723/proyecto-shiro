/**
 * useToolApproval — escucha las peticiones de aprobación de tools `confirm`
 * que el core-host emite (`tool:requires-approval`) y responde con la
 * decisión del usuario (`tool:approval`). Espejo del patrón de
 * `useSecretsSave`: el server espera la respuesta correlacionada por
 * `requestId` (ver `approval-gate.ts`).
 *
 * El loop tool-use del server es **secuencial**, así que solo hay una
 * petición pendiente a la vez. Si llegara otra antes de responder, la nueva
 * reemplaza a la anterior (no debería pasar con un solo cliente activo).
 */

import { useCallback, useState } from 'react';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import { useBus, useBusEvent } from '../../use-bus';

export interface PendingApproval {
  requestId: string;
  toolId: string;
  toolName: string;
  argsPreview: string;
}

export interface UseToolApprovalResult {
  /** Petición esperando decisión, o `null` si no hay ninguna. */
  pending: PendingApproval | null;
  /** Responde la petición actual: `true` = permitir, `false` = cancelar. */
  respond: (approved: boolean) => void;
}

export function useToolApproval(userId = 'me'): UseToolApprovalResult {
  const bus: IEventBus<EventMap> = useBus();
  const [pending, setPending] = useState<PendingApproval | null>(null);

  useBusEvent('tool:requires-approval', (p) => {
    setPending({
      requestId: p.requestId,
      toolId: p.toolId,
      toolName: p.toolName,
      argsPreview: p.argsPreview,
    });
  });

  const respond = useCallback(
    (approved: boolean) => {
      setPending((current) => {
        if (current !== null) {
          void bus.emit('tool:approval', { requestId: current.requestId, approved, userId });
        }
        return null;
      });
    },
    [bus, userId],
  );

  return { pending, respond };
}
