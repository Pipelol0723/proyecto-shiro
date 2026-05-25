/**
 * Re-exports públicos del paquete de tipos.
 * Los clientes externos (futuro mobile, arduino-bridge, etc.) importan desde
 * `@proyecto-shiro/core` y las definiciones se canalizan a través de aquí.
 */

export type { Emotion } from './emotions.js';
export { EMOTIONS, isEmotion } from './emotions.js';

export type { EventMap, EventName } from './events.js';
