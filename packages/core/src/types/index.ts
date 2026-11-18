/**
 * Re-exports públicos del paquete de tipos.
 * Los clientes externos (futuro mobile, arduino-bridge, etc.) importan desde
 * `@proyecto-shiro/core` y las definiciones se canalizan a través de aquí.
 */

export type { Emotion } from './emotions.js';
export { EMOTIONS, isEmotion } from './emotions.js';

export type {
  EventMap,
  EventName,
  GeminiVoiceStatus,
  ServiceStatus,
  SystemHealthReport,
} from './events.js';

export type { TurnFailureReason } from './turn-failure.js';
export { TURN_FAILURE_REASONS, classifyTurnFailure, isTurnFailureReason } from './turn-failure.js';
