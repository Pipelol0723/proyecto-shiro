/**
 * Motivo por el que un LLM no pudo responder, en una lista cerrada.
 *
 * Viaja en `llm:failed` para que el cliente explique el fallo sin recibir el
 * texto del error, que puede traer URLs o trozos de la petición. Ver la nota
 * del 2026-11-14 en ADR 0016.
 */
export const TURN_FAILURE_REASONS = [
  /** No hay clave configurada. */
  'missing-key',
  /** El servicio rechazó la clave (401 o 403). */
  'auth',
  /** Límite de uso o de saldo (429). */
  'quota',
  /** El servicio no responde o falla: red, tiempo límite o 5xx. */
  'unavailable',
  /** El servicio no tiene el modelo pedido (404). */
  'model-missing',
  'unknown',
] as const;

export type TurnFailureReason = (typeof TURN_FAILURE_REASONS)[number];

/** `code` de los errores de «falta la clave» de los módulos LLM. */
export const MISSING_API_KEY_CODE = 'MISSING_API_KEY';

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const UNAVAILABLE_NAMES = new Set(['AbortError', 'TimeoutError']);

/** Niveles de `cause` que se recorren; los mismos casos que cubre el logger, con margen. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Clasifica un fallo recorriendo su cadena `cause`: gana el primer nivel con
 * una pista reconocible (`code`, `status` o `name`). Los módulos LLM envuelven
 * el error real en uno genérico, así que el motivo suele estar uno o dos
 * niveles más abajo.
 */
export function classifyTurnFailure(err: unknown): TurnFailureReason {
  const seen = new Set<unknown>();
  let current = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) break;
    seen.add(current);
    const level = current as { code?: unknown; status?: unknown; name?: unknown; cause?: unknown };
    const reason = classifyLevel(level);
    if (reason !== undefined) return reason;
    current = level.cause;
  }
  return 'unknown';
}

function classifyLevel(level: {
  code?: unknown;
  status?: unknown;
  name?: unknown;
}): TurnFailureReason | undefined {
  if (level.code === MISSING_API_KEY_CODE) return 'missing-key';
  if (typeof level.status === 'number') {
    if (level.status === 401 || level.status === 403) return 'auth';
    if (level.status === 429) return 'quota';
    if (level.status === 404) return 'model-missing';
    if (level.status >= 500) return 'unavailable';
  }
  if (typeof level.code === 'string' && UNAVAILABLE_CODES.has(level.code)) return 'unavailable';
  if (typeof level.name === 'string' && UNAVAILABLE_NAMES.has(level.name)) return 'unavailable';
  return undefined;
}
