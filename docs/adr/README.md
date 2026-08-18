# Architecture Decision Records (ADRs)

Este directorio contiene los **ADRs** del proyecto. Un ADR es un documento
corto que captura **una decisión arquitectónica importante** junto con su
contexto y consecuencias.

## ¿Por qué escribir ADRs?

- **Memoria a largo plazo**: dentro de 6 meses no recordarás exactamente
  por qué elegimos X sobre Y. Un ADR te lo cuenta.
- **Onboarding**: cualquiera que se sume al proyecto puede entender la
  historia leyendo los ADRs en orden.
- **Disciplina**: te obliga a articular el porqué de una decisión, no solo
  el qué. Si no puedes escribir el ADR, probablemente no entiendes la
  decisión todavía.
- **Audit trail**: si revisamos una decisión más adelante (porque cambió
  el contexto), el ADR original sigue siendo válido como histórico. Se
  añade un nuevo ADR que lo supersede.

## ¿Cuándo escribir un ADR?

Cuando tomes una decisión que cumpla **alguna** de estas:

- Afecta a más de un módulo o paquete.
- Es difícil o caro de revertir.
- Introduce o descarta una dependencia importante.
- Establece un patrón que otros seguirán.
- Tu yo de dentro de 3 meses preguntará "¿por qué hicimos esto?".

No hace falta ADR para decisiones pequeñas y locales (nombre de variable,
estructura de un test). Sí hace falta para cambios estructurales.

## Cómo crear uno nuevo

1. Copia `template.md` a `NNNN-titulo-corto-en-kebab-case.md`, donde `NNNN`
   es el siguiente número libre con padding de ceros.
2. Rellena las secciones (Status, Context, Decision, Consequences, etc.).
3. Commit con `docs: add ADR NNNN — <titulo>`.
4. Si más adelante se invalida, no lo borres: añade un nuevo ADR que lo
   supersede y cambia el `Status` del antiguo a `Superseded by NNNN`.

## Estados posibles

| Estado               | Significado                                |
| -------------------- | ------------------------------------------ |
| `Proposed`           | Sugerido pero aún no acordado.             |
| `Accepted`           | Decidido y vigente.                        |
| `Deprecated`         | Ya no aplica pero no hay reemplazo formal. |
| `Superseded by NNNN` | Reemplazado por otro ADR.                  |

## Índice

| #                                                                        | Título                                                         | Estado             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------ |
| [0001](0001-arquitectura-modular-event-driven.md)                        | Arquitectura modular event-driven                              | Accepted           |
| [0002](0002-monorepo-npm-workspaces.md)                                  | Monorepo con npm workspaces                                    | Accepted           |
| [0003](0003-transport-abstraction-device-registry.md)                    | Transport abstraction y Device Registry                        | Accepted           |
| [0004](0004-custom-logger.md)                                            | Logger custom sin dependencias                                 | Accepted           |
| [0005](0005-typed-events-string-literals.md)                             | Tipado de eventos con string literals y EventMap               | Accepted           |
| [0006](0006-config-validation-zod.md)                                    | Validación de configuración con zod                            | Accepted           |
| [0007](0007-module-loader-registry.md)                                   | ModuleLoader con factory registry                              | Accepted           |
| [0008](0008-cliente-desktop-vite-react.md)                               | Cliente desktop con Vite + React + TypeScript                  | Accepted           |
| [0009](0009-orbe-placeholder-avatar.md)                                  | Orbe SVG como placeholder visual del avatar                    | Accepted           |
| [0010](0010-wiring-cliente-core-eventbus.md)                             | Wiring del cliente desktop con el EventBus                     | Accepted           |
| [0011](0011-core-split-browser-node.md)                                  | Split del core en entries browser-safe / Node                  | Accepted           |
| [0012](0012-split-cliente-server-core-host.md)                           | Split cliente/server — el core corre en `core-host`            | Accepted           |
| [0013](0013-protocolo-websocket-eventbus.md)                             | Protocolo WebSocket para el EventBus                           | Accepted           |
| [0014](0014-llm-structured-output-text-emotion.md)                       | Salida estructurada del LLM — `{ text, emotion }`              | Accepted           |
| [0015](0015-hybrid-router-classifier-llm-based.md)                       | HybridRouter — clasificador LLM con fallback heurístico        | Accepted           |
| [0016](0016-pipeline-conversational-wiring.md)                           | Wiring del pipeline conversacional en `core-host`              | Accepted           |
| [0017](0017-memoria-persistente-local-y-letta.md)                        | Memoria persistente — LocalMemory + LettaMemory                | Accepted           |
| [0018](0018-letta-sdk-oficial-embeddings-ollama.md)                      | Integración Letta — SDK oficial + embeddings Ollama            | Accepted           |
| [0019](0019-stt-faster-whisper-microservicio-python.md)                  | STT — microservicio Python con faster-whisper                  | Accepted           |
| [0020](0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) | TTS — ElevenLabs + SystemTTS fallback, in-process en core-host | Accepted           |
| [0021](0021-avatar-live2d-pixi-display-fallback-orbe.md)                 | Avatar Live2D — pixi-live2d-display, 30 fps, fallback al Orbe  | Accepted           |
| [0022](0022-shiro-agentic-tools-fs-shell.md)                             | Shiro agentic — slot `tools:`, FS + shell, permisos mixtos     | Accepted           |
| [0023](0023-shiro-self-improvement-propose-only.md)                      | Shiro self-improvement — propose only, worktree aislado        | Accepted           |
| [0024](0024-packaging-tauri-windows-sidecar.md)                          | Packaging Tauri — Windows V1, sidecar core-host, modo dual     | Accepted           |
| [0025](0025-modelo-de-confianza-local-y-superficie-de-red.md)            | Modelo de confianza local y superficie de red                  | Superseded by 0027 |
| [0026](0026-estacion-holografica-pepper-ghost-cliente-ligero.md)         | Estación holográfica — lámina única + cliente ligero           | Accepted           |
| [0027](0027-autenticacion-token-bus-stt-multicliente.md)                 | Autenticación por token compartido en el bus y el STT          | Accepted           |

## Referencias externas

- [Michael Nygard — Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [adr.github.io](https://adr.github.io/) — colección de ejemplos y plantillas.
