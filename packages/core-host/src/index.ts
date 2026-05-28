/**
 * `@proyecto-shiro/core-host` — servidor Node que arranca el Orchestrator
 * y expone su EventBus a clientes (desktop, móvil, IoT bridge) via WebSocket.
 *
 * Vive en el lado server del split definido en ADR 0012. La API key de
 * Anthropic, lectura de YAML del disco, y conexión a Ollama/Letta corren
 * aquí — el cliente desktop solo recibe eventos del bus por WS.
 *
 * Este paquete arranca minimal (PR 1 — solo skeleton). Las piezas reales
 * llegan después:
 *
 * - PR 2: `WebSocketServerTransport` (implementa `ITransport` server-side).
 * - PR 3: `bootstrap.ts` + `server.ts` — registra módulos en el
 *   `ModuleLoader`, instancia `Orchestrator`, abre el server HTTP+WS.
 * - PRs 5/6: registro de `OllamaLLM` y `AnthropicLLM`.
 * - PR 7: wiring del pipeline conversacional (`user:message` → router → LLM).
 */

export const VERSION = '0.1.0';

export { WebSocketServerTransport } from './transports/websocket-server-transport.js';
export type { WebSocketServerTransportOptions } from './transports/websocket-server-transport.js';

export { bootstrap } from './bootstrap.js';
export type { BootstrapOptions, BootstrapResult } from './bootstrap.js';

export { wireConversationFlow } from './pipeline/conversation-flow.js';
export type { WireConversationFlowOptions } from './pipeline/conversation-flow.js';

export { NoopAvatar, NoopLLM, NoopMemory, NoopSTT, NoopTTS } from './mocks/noop-modules.js';
