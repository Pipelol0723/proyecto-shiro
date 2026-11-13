/**
 * Se lanza (como rechazo de la promesa) cuando se intenta enviar por un
 * transport cuya conexión no está abierta. El emisor se entera por este
 * rechazo; la UI, por `IObservableTransport.onStateChange`.
 *
 * Ver ADR 0013 (enmienda 2026-11-13).
 */
export class TransportNotOpenError extends Error {
  override readonly name = 'TransportNotOpenError';
}
