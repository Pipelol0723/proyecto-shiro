/**
 * Wire schema — envelope que viaja por todos los transports remotos.
 *
 * Ver [ADR 0013](../../../../../docs/adr/0013-protocolo-websocket-eventbus.md).
 *
 * Browser-safe: solo depende de `zod`. Lo usan ambos lados (cliente y
 * server) para serializar y validar los mensajes que cruzan WebSocket.
 *
 * Convenciones:
 * - `v` permite versionar el protocolo sin romper.
 * - `kind: 'event'` es el único tipo en V1; reservado para futuros
 *   `'subscribe' | 'hello' | 'resume' | ...`.
 * - `payload: unknown` — el `EventMap` es la fuente de verdad del tipo
 *   real; quien consuma valida si necesita.
 * - `ts` es informativo (diagnóstico, latency tracking). No se valida
 *   como datetime estricto para no atarse a una versión concreta de zod.
 */

import { z } from 'zod';

export const WIRE_PROTOCOL_VERSION = 1 as const;

export const WireEnvelopeSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  kind: z.literal('event'),
  name: z.string().min(1, 'el nombre del evento no puede estar vacío'),
  payload: z.unknown(),
  ts: z.string().min(1),
});

export type WireEnvelope = z.infer<typeof WireEnvelopeSchema>;

/**
 * Construye un envelope nuevo a partir de un evento y su payload. El `ts`
 * se rellena con `new Date().toISOString()` — el reloj del emisor.
 */
export function makeEnvelope(event: string, payload: unknown): WireEnvelope {
  return {
    v: WIRE_PROTOCOL_VERSION,
    kind: 'event',
    name: event,
    payload,
    ts: new Date().toISOString(),
  };
}

/**
 * Construye y serializa de un golpe. Útil porque siempre se hace junto.
 */
export function serializeEnvelope(event: string, payload: unknown): string {
  return JSON.stringify(makeEnvelope(event, payload));
}

/**
 * Resultado de parsear/validar un envelope entrante. Discriminated union
 * para que el receptor maneje el caso de error sin try/catch.
 */
export type ParseResult =
  | { readonly ok: true; readonly envelope: WireEnvelope }
  | { readonly ok: false; readonly reason: string };

/**
 * Intenta parsear un string como envelope V1. Nunca lanza — devuelve
 * el resultado en forma de discriminated union para que el caller decida
 * qué hacer (loggear, cerrar conexión, ignorar, etc.).
 */
export function parseEnvelope(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `JSON inválido: ${(err as Error).message}` };
  }
  const parsed = WireEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `envelope inválido: ${parsed.error.message}` };
  }
  return { ok: true, envelope: parsed.data };
}
