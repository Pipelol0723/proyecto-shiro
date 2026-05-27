# ADR 0012: Split cliente/server — el core corre en un proceso Node aparte (`core-host`)

- **Status**: Accepted
- **Fecha**: 2026-05-27
- **Decidido por**: Pipelol0723

## Contexto

Hasta ahora todo el companion vive **en el bundle del cliente desktop** (Vite + React + browser). El `Orchestrator`, el `EventBus`, los módulos: todo se instancia en JS del navegador y usa `InProcessTransport` (ver [ADR 0003](0003-transport-abstraction-device-registry.md)). Esto funcionó para Setup, Core y Cliente desktop porque ningún módulo necesitaba secretos.

El hito **LLM** rompe esta tranquilidad por dos motivos:

1. **`AnthropicLLM` necesita `ANTHROPIC_API_KEY`.** Si lo metemos en el bundle del browser, la key queda visible en el JS minified servido por Vite (`import.meta.env.VITE_*`). Un usuario que clone el repo podría inspeccionar el bundle y verla en DevTools. Aceptable para un dev solo en su máquina — peligroso de arrastrar como patrón.
2. **Los siguientes módulos del roadmap (Memoria con Letta, STT con faster-whisper) hablan con servicios externos.** Cliente-side puede ser viable, pero retorcer el frontend para que orqueste todo desde el browser va contra [ADR 0001](0001-arquitectura-modular-event-driven.md) ("cerebro independiente, clientes ligeros").

Además, el plan a medio plazo ya incluye **móvil, Arduino bridge y IoT bridge** consumiendo el core. Si el core sigue viviendo dentro del cliente desktop, esos paquetes futuros no tienen forma de conectarse — habría que duplicar el orchestrator en cada cliente.

Hay que decidir **dónde corre el core** durante el hito LLM y cómo se conecta el cliente desktop.

## Decisión

**El core se mueve a un proceso Node aparte: nuevo paquete `@proyecto-shiro/core-host`.**

```
┌──────────────────────────┐      WebSocket      ┌─────────────────────────┐
│  Cliente desktop (Vite)  │ ◄──────────────────►│  @proyecto-shiro/core-  │
│                          │                     │  host (proceso Node)    │
│  - EventBus local        │   eventos tipados    │                         │
│  - WebSocketTransport    │   ({kind,name,payload})│ - EventBus            │
│  - UI + Avatar           │                     │  - Orchestrator         │
│                          │                     │  - LLM / Router /       │
│                          │                     │    Memory / STT / TTS   │
└──────────────────────────┘                     │  - API keys via         │
                                                  │    process.env          │
                                                  └────────────┬────────────┘
                                                               │
                                                               ▼
                                                   localhost:11434 (Ollama)
                                                   api.anthropic.com
```

### Reparto de responsabilidades

| Slot del YAML           | Server (`core-host`)    | Cliente (`desktop`) |
| ----------------------- | ----------------------- | ------------------- |
| `llm.local` (Ollama)    | ✅                      | —                   |
| `llm.cloud` (Anthropic) | ✅                      | —                   |
| `router` (Hybrid)       | ✅                      | —                   |
| `memory` (Letta/Local)  | ✅ (cuando llegue)      | —                   |
| `stt` (Whisper)         | ✅ (cuando llegue)      | —                   |
| `tts` (ElevenLabs)      | ✅ (cuando llegue)      | —                   |
| `avatar` (Live2D)       | —                       | ✅ (necesita DOM)   |
| `character` (YAML)      | ✅ (lo carga el server) | (recibe via evento) |

El cliente recibe los eventos `bus:ready`, `router:routed`, `llm:chunk`, `llm:responded`, `tts:audio-ended`, etc. y los pinta. Emite `user:message` cuando el usuario escribe o termina de hablar.

### Transport

El cliente usa un nuevo `WebSocketTransport` (lo planea [ADR 0013](0013-protocolo-websocket-eventbus.md)) que implementa `ITransport` (ADR 0003 ya previó esto). El server usa el mismo contrato del otro lado. El `EventBus` no cambia — sigue siendo agnóstico al transport.

### Hosting de la API key

```
.env (raíz del repo, NUNCA commiteada, en .gitignore)
├── ANTHROPIC_API_KEY=sk-ant-...
└── OLLAMA_HOST=http://localhost:11434
```

El server lee con `process.env.*` (Node nativo). El cliente nunca ve la key — vive solo en el proceso Node.

### Dev workflow

```bash
npm run dev   # arranca core-host y desktop en paralelo con concurrently
```

Logs entrelazados. Cuando crezca, partir en dos terminales es trivial (`npm run dev -w core-host` + `npm run dev -w desktop`).

### Sin compatibilidad con Opción A (in-process)

No mantenemos un modo "todo cliente". El `InProcessTransport` queda para tests, no para producción ni dev. Esto evita ramas de código `if (mode === 'standalone')` que se pudrirían rápidamente.

## Alternativas consideradas

- **Opción A — In-process con `VITE_ANTHROPIC_API_KEY`**: descartada. Funcionalmente la más rápida (cero infraestructura), pero la key vive en el bundle del browser. Aceptable mientras sea un dev solo en su máquina; arrastra deuda en cuanto se distribuye. Y la migración A→B implicaría reescribir bootstrap del cliente.
- **Opción C — Sidecar Node de Tauri**: descartada por ahora. Es la arquitectura "correcta" a largo plazo pero requiere haber hecho el hito Packaging Tauri antes (no es viable en este hito). Cuando llegue Tauri, el `core-host` se convierte en sidecar del binario sin cambiar el código.
- **Mini servidor con `fetch` HTTP en lugar de WebSocket**: descartado. El bus es bidireccional (eventos van en ambos sentidos), HTTP request/response no encaja sin polling o SSE. WebSocket es el match natural.
- **Compartir un Worker / Service Worker en lugar de proceso Node**: descartado. El Worker sigue siendo browser-side, la API key seguiría en el bundle. No resuelve el problema.
- **Usar Anthropic Agent SDK con auth de Claude Code subscription**: descartado para uso del producto. La doc oficial dice _"Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products"_. Además, el Agent SDK está diseñado para tareas agénticas con tools, no para chat con system prompt — sería usar la herramienta equivocada.

## Consecuencias

### Positivas

- **API keys nunca cruzan al bundle del browser.** La key vive en `process.env` del server.
- **El plan original de ADR 0001 ("cerebro como servicio independiente") empieza a materializarse.** Cuando llegue móvil, solo añade un cliente más conectado al mismo server.
- **Cuando llegue Tauri**, el `core-host` se convierte en sidecar del binario nativo. Refactor mínimo.
- **Cliente desktop se simplifica.** Ya no instancia módulos LLM/Router/Memory — solo UI + Avatar + transport.
- **Tests integration cross-package son posibles**: spawn de un server, conectar cliente, verificar round-trip.
- **Permite reiniciar el cliente sin perder contexto.** El server mantiene la conversación; el HMR del cliente no rompe nada.

### Negativas / Riesgos

- **Dos procesos en dev.** El usuario necesita `npm run dev` (que arranca ambos) en lugar de uno solo. Mitigación: script raíz con `concurrently`.
- **HMR de los módulos del server ya no es instantáneo.** Cuando edites `OllamaLLM`, hay que reiniciar el server (manual o `tsx watch`). El HMR del cliente sigue intacto porque vive en el lado Vite.
- **Latencia añadida por WebSocket.** En localhost son <1 ms — irrelevante. Cuando el cliente sea remoto (móvil), depende de la red.
- **Más complejidad de debugging.** Un bug puede estar en el cliente, en el server, o en el transport. Mitigación: cada lado loguea su EventBus con prefijo distinto (`[client]` vs `[host]`).
- **Tests del cliente desktop tienen que mockear el transport.** No deben requerir un server real corriendo. Mitigación: tests E2E reales viven en `core-host/tests/integration/`.

### Neutrales

- **El paquete `core-host` empieza minimal en este PR**: solo skeleton. El transport real llega en PR 2; el bootstrap real en PR 3.
- **`InProcessTransport` sigue existiendo y se usa en tests del core.** No se borra — es la implementación más simple de `ITransport`, útil como referencia.
- **El cliente desktop pierde el `sample-flow.ts`** cuando lleguen los módulos reales (PR 7). De momento sigue funcionando con mocks del lado server (PR 3).

## Notas de implementación

- `packages/core-host/` — nuevo paquete:
  - `package.json` — name `@proyecto-shiro/core-host`, type `module`, deps `@proyecto-shiro/core`, `ws`, dev-deps `tsx`, `@types/ws`.
  - `tsconfig.json` — extiende `tsconfig.base.json`, target Node, output `dist/`.
  - `src/index.ts` — placeholder en este PR; el bootstrap real llega en PR 3.
  - `vitest.config.ts` — environment `node`, registro en `vitest.workspace.ts`.
  - `tests/smoke.test.ts` — verifica que builda y exporta.
- `package.json` raíz — workspace ya cubre `packages/*`, no requiere cambio adicional.
- `vitest.workspace.ts` — añadir entry para `core-host`.
- `README.md` raíz — actualizar tabla de hitos (LLM 🟡) y estructura del monorepo (añadir `core-host`).
- `CLAUDE.md` — ya actualizado fuera de este PR.
- `.gitignore` — verificar que `.env` está cubierto (ya lo está vía `dist/`, `node_modules/`, etc.; añadir `.env` explícito si falta).
- **No** se toca el cliente desktop en este PR — la conexión vía WS llega en PR 3.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — arquitectura modular event-driven, base de toda la idea de "cerebro como servicio".
- [ADR 0002](0002-monorepo-npm-workspaces.md) — el monorepo es lo que hace viable que `core-host`, `desktop`, `mobile` sean paquetes hermanos consumiendo el core.
- [ADR 0003](0003-transport-abstraction-device-registry.md) — ya previó `WebSocketTransport` como implementación natural cuando llegara red.
- [ADR 0011](0011-core-split-browser-node.md) — el split browser-safe / Node del core es lo que permite que el server use `@proyecto-shiro/core/node` y el cliente solo el barrel browser-safe.
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — el wire format que los eventos usan al cruzar.
