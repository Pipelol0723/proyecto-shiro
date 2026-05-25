/**
 * Re-exports de todos los contratos del core.
 * Los módulos concretos implementan estas interfaces y los clientes
 * externos (cliente desktop, futuro mobile) las importan desde aquí.
 */

export type { IEventBus, EventHandler, Unsubscribe } from './IEventBus.js';
export type { ITransport, TransportReceiveHandler } from './ITransport.js';
export type { ILLMModule, LLMRequest, LLMResponse } from './ILLMModule.js';
export type { ITTSModule, TTSRequest, TTSResponse } from './ITTSModule.js';
export type { ISTTModule, STTRequest, STTResult } from './ISTTModule.js';
export type { IMemoryModule, MemoryEntry } from './IMemoryModule.js';
export type { IAvatarModule } from './IAvatarModule.js';
export type { IRouterModule, LLMTier } from './IRouterModule.js';
export type { IDeviceModule, DeviceStatus, DeviceCommand } from './IDeviceModule.js';
