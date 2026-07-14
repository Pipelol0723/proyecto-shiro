/**
 * Constructores de los turnos de memoria de self-dev (ADR 0023 Fase 2). El
 * bootstrap los usa para persistir el final de una sesión en dos formas:
 *
 * - `buildSelfDevToolTurn`: turno `role:'tool'` con la metadata estructurada
 *   (memoria interna, **filtrada del chat**) — así Shiro *recuerda* qué propuso
 *   y con qué resultado (contexto + búsqueda semántica). Reusa el plumbing del
 *   ADR 0022 §6, sin rol nuevo ni migración de SQLite.
 * - `buildSelfDevAnnounceTurn`: turno `role:'assistant'` con el texto hablado,
 *   para que el reporte de Shiro aparezca en el **chat al recargar** (el
 *   `announce` emite `llm:responded` en vivo pero no se persiste solo).
 *
 * Node-only (`@proyecto-shiro/core-host`).
 */

import { randomUUID } from 'node:crypto';
import type { EventMap, MemoryEntry, SelfDevTurnMetadata } from '@proyecto-shiro/core';
import type { SelfDevOutcome } from './selfdev-session.js';

/** Texto en primera persona del outcome (alimenta contexto + embeddings de Letta). */
function outcomeText(o: SelfDevOutcome): string {
  if (o.ok) {
    const url = o.prUrl !== undefined ? `: ${o.prUrl}` : '';
    const cambio = o.summary !== undefined && o.summary.length > 0 ? ` Cambio: ${o.summary}` : '';
    return `Propuse un PR sobre "${o.topic}"${url}.${cambio}`;
  }
  return `Intenté self-dev sobre "${o.topic}" pero no se completó: ${o.reason ?? 'motivo desconocido'}.`;
}

/** Turno `role:'tool'` que resume la sesión (memoria interna, no burbuja de chat). */
export function buildSelfDevToolTurn(outcome: SelfDevOutcome, userId: string): MemoryEntry {
  return {
    id: randomUUID(),
    role: 'tool',
    text: outcomeText(outcome),
    timestamp: new Date().toISOString(),
    userId,
    metadata: {
      kind: 'selfdev',
      topic: outcome.topic,
      ok: outcome.ok,
      prUrl: outcome.prUrl,
      branch: outcome.branch,
      reason: outcome.reason,
      summary: outcome.summary,
    } satisfies SelfDevTurnMetadata,
  };
}

/** Turno `role:'assistant'` con el reporte hablado (aparece en el chat al recargar). */
export function buildSelfDevAnnounceTurn(
  text: string,
  emotion: EventMap['llm:responded']['emotion'],
  userId: string,
): MemoryEntry {
  return {
    id: randomUUID(),
    role: 'assistant',
    text,
    timestamp: new Date().toISOString(),
    userId,
    metadata: { emotion, source: 'selfdev' },
  };
}
