/**
 * Approval gate (ADR 0022 §4) — coordina la aprobación humana de las tools
 * `confirm`. Cuando el pipeline pide aprobar una acción, emite
 * `tool:requires-approval` al bus y **espera** (Promise) el `tool:approval`
 * del cliente con el mismo `requestId`. Si nadie responde en `timeoutMs`,
 * resuelve `false` (cancelado) para no colgar el turno.
 *
 * Se crea **una sola vez** por `wireConversationFlow` (una suscripción al
 * bus, no por turno). `dispose()` la limpia.
 */

import { randomUUID } from 'node:crypto';
import type { EventMap, IEventBus, Logger } from '@proyecto-shiro/core';

export interface ApprovalRequest {
  toolId: string;
  toolName: string;
  argsPreview: string;
  userId: string;
}

export interface ApprovalGate {
  /** Pide aprobación; resuelve `true`/`false` (false por rechazo o timeout). */
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  /** Limpia la suscripción al bus y cancela las pendientes. */
  dispose(): void;
}

/** Default generoso: 5 min para que el humano decida sin colgar el turno. */
const DEFAULT_TIMEOUT_MS = 300_000;

interface PendingEntry {
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

export function createApprovalGate(
  bus: IEventBus<EventMap>,
  logger: Logger,
  options: { timeoutMs?: number } = {},
): ApprovalGate {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<string, PendingEntry>();

  const unsub = bus.on('tool:approval', (p) => {
    const entry = pending.get(p.requestId);
    if (entry === undefined) return; // requestId desconocido / ya resuelto
    pending.delete(p.requestId);
    clearTimeout(entry.timer);
    entry.resolve(p.approved);
  });

  return {
    requestApproval(req: ApprovalRequest): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => {
          if (pending.delete(requestId)) {
            logger.warn(`aprobación de ${req.toolId} expiró (${String(timeoutMs)}ms) — cancelada`);
            resolve(false);
          }
        }, timeoutMs);
        pending.set(requestId, { resolve, timer });
        void bus.emit('tool:requires-approval', {
          requestId,
          toolId: req.toolId,
          toolName: req.toolName,
          argsPreview: req.argsPreview,
          userId: req.userId,
        });
      });
    },
    dispose(): void {
      unsub();
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.resolve(false);
      }
      pending.clear();
    },
  };
}
