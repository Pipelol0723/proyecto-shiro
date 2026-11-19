# Proyecto Shiro

AI Companion modular con avatar tipo VTuber, voz en tiempo real, memoria
persistente y sistema de módulos intercambiables. Diseñado para crecer:
empieza como asistente desktop, escala a IoT, móvil, Arduino y robots.

> **Estado (2026-11-12)**: hitos 1 a 11 hechos; el 12 (estación holográfica)
> está planificado y sin empezar. Lo que toca ahora es el
> [plan de mejora](docs/plan-mejora-2026-11.md), una propuesta pendiente de
> aprobación ítem a ítem que sale de la
> [revisión del estado](docs/revision-estado-2026-11.md) (fichas en el
> [anexo](docs/revision-estado-2026-11-anexo.md)). El estado vive solo en la
> tabla de la sección [Roadmap](#roadmap). Lo mantiene una persona, sin horas
> fijas ni plazos, con agentes de IA como apoyo. Arquitectura viva en
> [`docs/architecture.md`](docs/architecture.md); historial de decisiones en
> [`docs/adr/`](docs/adr/).

<a id="roadmap"></a>

## 🗺️ Roadmap

Esta tabla es la **única fuente** del estado de los hitos y de la hoja de ruta
([ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md)): los
demás documentos enlazan aquí y no la copian. Los hitos van numerados por
orden de la tabla (1 a 12, numeración de `CLAUDE.md` desde ADR 0008); la
numeración Fase 0-7 del [plan inicial](plan-modular-ai-companion.md) queda en
el histórico. «Ahora» y «Siguiente» siguen el
[plan de mejora](docs/plan-mejora-2026-11.md): la Fase 1 está aprobada
desde el 2026-11-13; las demás fases, pendientes de aprobación.

| Hito                                                            | Estado                                                 | ADR                              | Notas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Setup**                                                       | ✅ completo                                            | 0002                             | Monorepo, CI (solo Ubuntu), ADRs, CLAUDE.md. `develop` aún no exige check de CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Core**                                                        | ✅ completo                                            | 0001, 0003-0007                  | EventBus, Orchestrator, ModuleLoader, 9 interfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Cliente desktop**                                             | ✅ completo                                            | 0008-0011                        | Vite + React + TS, orbe, 3 temas, 5 pantallas, EventBus wiring                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **LLM**                                                         | ✅ completo                                            | 0012-0016                        | `core-host` (Node + WebSocket), OllamaLLM (`qwen2.5:3b`), AnthropicLLM (`claude-sonnet-4-6`), HybridRouter, pipeline conversacional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Memoria**                                                     | ✅ completo                                            | 0017, 0018                       | Letta (SDK oficial, embeddings `mxbai-embed-large` en Ollama) + WAL SQLite con drainer, auto-provisión y `memory:snapshot`. Aún sin backup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **STT**                                                         | ✅ completo                                            | 0019                             | faster-whisper (`small`, `int8`) en microservicio Python (Docker + CUDA), AudioWorklet, push-to-talk y WS directo cliente↔servicio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **TTS**                                                         | ✅ completo                                            | 0020, 0034                       | ElevenLabs + SystemTTS de respaldo, in-process en core-host; audio HTTP efímero, cancelable, mute por cliente. Cadena de voz configurable; voz diseñada de Gemini (`GeminiTTS`) implementada y sin activar: [cómo probarla](#voz-de-gemini-probarla-y-pasar-al-nivel-de-pago)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Avatar Live2D**                                               | ✅ completo                                            | 0021                             | Hiyori (provisional) con `pixi-live2d-display-lipsyncpatch` y Cubism Core 4.2.2, fallback al orbe, lip-sync y expresiones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Packaging Tauri**                                             | ✅ completo                                            | 0024                             | Binario Windows con sidecar `core-host`, tray, setup wizard con API keys. El auto-updater está en el código pero nunca ha servido una actualización: el release v0.1.0 sigue en borrador.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Agentic tools**                                               | ✅ completo                                            | 0022                             | fs y shell con allowlist, loop tool-use en Claude, modal de aprobación, turnos `role:'tool'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Self-improvement**                                            | ✅ completo                                            | 0023                             | PRs propose-only desde un worktree aislado, eval gate, solo en dev. El resultado de cada sesión se guarda en memoria (PR #94); retomar una sesión sigue pendiente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Plan de mejora — Fase 1: contención y red cerrada               | ✅ hecha (2026-11-13); falta el release firmado (P-09) | 0029                             | Hecho: self-dev apagado por defecto (P-01, `selfdev.enabled: false`, PR #102), suite verde en Windows, logger que serializa `Error` y `npm run verify` (P-02, PRs #101, #104 y #106), CI con audit de producción, permisos mínimos, dependabot y check obligatorio (P-04, PRs #107 y #108), bus y `/audio` en loopback con `Origin` validado y aprobación estricta (P-05, PRs #116 y #117), voz que no se corta al cambiar de pantalla (P-07b, PR #121), estado de conexión visible (P-07a, PRs #127 y #131), herramientas de desarrollo al día dentro de su major (P-44, PRs #129, #130 y #132), modal de aprobación con foco en Cancelar y contraste legible (P-08, PR #105), Letta y Whisper publicados solo en loopback con Letta fijada por digest (P-06a, PR #134), Whisper con topes de audio, `Origin` validado y usuario sin root (P-06b, PR #136), y AGENTS.md generado desde CLAUDE.md y comprobado en `verify` (P-03a, PR #137). Con esto se cumple el gate de la fase. Hecho también P-03b: plantilla de encargo (PR #138), `.gitignore` acotado (PR #139) y ramas muertas borradas. De P-09 están hechas las Actions fijadas por SHA (PR #140); el release firmado, con clave nueva, espera a que haya una versión que publicar. Ver [`docs/plan-mejora-2026-11.md`](docs/plan-mejora-2026-11.md). |
| **Estación holográfica** (hito 12)                              | ⏳ planificado, sin empezar                            | 0026, 0027                       | Pepper ghost + cliente ligero; plan en [`docs/estacion-holografica.md`](docs/estacion-holografica.md). Su prerrequisito, ADR 0027 (token, bind, Origin), está Accepted y en curso: falta el token. Sin fecha desde el 2026-11-14: el protocolo multicliente que necesita está en espera.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Ahora**                                                       |                                                        |                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Plan de mejora — Fase 2: datos a salvo y diagnóstico            | 🚧 ahora (aprobada el 2026-11-14)                      | —                                | Backup de la memoria fuera del portátil con restauración ensayada, health «listo», push-to-talk fiable, latencia medida, CI también en Windows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Avatar: la chibi en la app y cambio de modelo en caliente       | 🚧 ahora (paso AV-3)                                   | 0028, 0035                       | Shiro tendrá tres modelos (chibi, 2D y 3D) que se cambian en caliente, en modo normal y overlay. La chibi por capas ya está en la app; sigue elegir modelo a mano. Orden en el [plan](docs/plan-mejora-2026-11.md#vía-paralela-avatar-y-modelos).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Rediseño de la app: tema «Shiro» y tres destinos                | 🚧 ahora (arranca tras AV-2)                           | enmienda de 0008                 | Diseño aprobado el 2026-11-14: un solo tema, tres destinos, chip de estado y modo dev. Pasos RD-1 a RD-10 en el [plan](docs/plan-mejora-2026-11.md#vía-paralela-rediseño-de-la-app).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Iniciativa de Shiro: la base y hablar primero (bloque 1)        | 🚧 ahora (aprobado con el plan; empieza por su ADR)    | ADR nuevo, por escribir          | Shiro empieza turnos: saluda, comenta tras un silencio largo y avisa de recordatorios. Antes, lo que hoy falta: cola de turnos, hora en el contexto, poder callar y un tope de gasto. Pasos IN-F e IN-0 a IN-6 del [plan](docs/plan-mejora-2026-11.md#vía-paralela-iniciativa-sentidos-vida-propia-y-directos).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Siguiente** (plan de mejora, en este orden)                   |                                                        |                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Plan de mejora — Fase 3: fronteras de agentes                   | ⏳ siguiente                                           | enmiendas de 0022, 0023 y 0024   | Suite «contrato de seguridad», push de self-dev tras la aprobación, eval aislado; self-dev se reactiva al cerrarla.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Plan de mejora — Fase 4 (recortada): turno correcto             | ⏳ siguiente                                           | ADR nuevos propuestos en el plan | Tool-loop honesto, SDK de Anthropic 1.x y datos separados de instrucciones en el contexto. Recortada el 2026-11-14: las URLs de servicios por entorno esperan con el resto de la Fase 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Plan de mejora — Fase 5 (reducida): entradas del bus y secretos | ⏳ siguiente                                           | —                                | Reducida el 2026-11-14: validación de lo que entra por el bus y cuidado de los secretos. El protocolo multicliente y el token esperan a que se planee un segundo cliente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Iniciativa de Shiro: bloques 2 a 5                              | ⏳ por aprobar, bloque a bloque                        | ADR nuevos, por escribir         | Memoria con tipos y ámbitos (retomar temas, memoria pública separada), tres modos de autonomía, sentidos enchufables (equipo, música, Discord, correo, casa) con avisos por importancia, y vida propia del avatar (sueño por grados y gestos; su parte de diseño espera).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Ideas y aplazados** (sin compromiso)                          |                                                        |                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Modo overlay                                                    | ⏸️ aplazado                                            | 0024 §3                          | Ventana flotante always-on-top estilo VTuber.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Protocolo multicliente y token (resto de la Fase 5)             | ⏸️ en espera                                           | 0027 (+ ADR nuevo propuesto)     | `clientId`, unicast y token en el handshake. Es la puerta de la estación, del móvil y de cualquier segundo cliente; se retoma cuando se planee uno. Con él esperan la topología por entorno y la URL de STT publicada (de la Fase 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Modelos 2D y 3D de Shiro                                        | 💡 cuando existan el arte y el modelo                  | 0028                             | 2D en Live2D (torso primero) y 3D en VRM (`@pixiv/three-vrm`, con su ADR). Entran como un motor o un manifiesto más (paso AV-8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Shiro en los directos                                           | 💡 planeado; se hace después                           | ADR nuevo, por escribir          | Copresentar, dirigir la producción y jugar en Twitch con OBS, sobre la iniciativa. Pasos D-0 a D-9 del [plan](docs/plan-mejora-2026-11.md#vía-paralela-iniciativa-sentidos-vida-propia-y-directos).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Retomar sesiones de self-dev                                    | 💡 idea                                                | 0023                             | Hoy se guarda el resultado de la sesión, no su plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tool de edición por parche                                      | 💡 idea                                                | —                                | Hoy self-dev reescribe el archivo entero.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Orquestación multi-agente / multi-modelo                        | 💡 idea                                                | —                                | Antes hacen falta: contabilidad del gasto en cloud, la tool de parche, varias sesiones reales de self-dev y un ADR de router por roles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Modelos locales mayores y voz sintética local (UTAU)            | 💡 cuando haya una GPU con más VRAM                    | 0020                             | Hoy todo corre en una GTX 1650 de 4 GB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Plugins                                                         | 💡 idea                                                | —                                | Sistema de extensiones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Móvil                                                           | 💡 idea                                                | —                                | `@proyecto-shiro/mobile` por WebSocket; necesita el protocolo multicliente, en espera.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Arduino bridge                                                  | 💡 idea                                                | —                                | `@proyecto-shiro/arduino-bridge` (Serial USB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| IoT bridge                                                      | 💡 idea                                                | —                                | MQTT, Home Assistant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Stack

- **TypeScript** (ESM, strict) + **Node.js 22**
- **npm workspaces** para el monorepo
- **Vite + React 18** para `@proyecto-shiro/desktop` (cliente)
- **Tauri 2.0** empaqueta el cliente como binario nativo Windows (sidecar `core-host`, tray, auto-updater firmado) — ver ADR 0024
- **Ollama + Qwen 2.5** para LLM local
- **Claude Sonnet** vía Anthropic SDK para LLM cloud
- **faster-whisper** (microservicio Python) para STT
- **ElevenLabs** (cloud, primary hoy) + **SystemTTS** (voz del OS, fallback) para TTS, con **Gemini** (voz diseñada, ADR 0034) como primera opción opcional de la cadena (in-process en core-host, audio HTTP efímero)
- **Letta** (Docker) para memoria larga, **LocalMemory** SQLite como fallback
- **Live2D Cubism SDK Web** (Core **4.2.2**) + **pixi-live2d-display-lipsyncpatch** (PixiJS v7) para avatar 2D con lip-sync
- **Vitest** para tests

## Requisitos

- Node.js 22 (22.13 o posterior), la versión de `.node-version`. Es la que usan el CI y el sidecar del binario; con otra, `build:sidecar` se niega a empaquetar
- npm >= 10
- **Rust 1.90+** (solo para `tauri:dev` y `tauri:build` — el modo dev de Vite no lo requiere). Instala desde [rustup.rs](https://rustup.rs/).
- En Windows: **Microsoft C++ Build Tools** + **WebView2 Runtime** (preinstalado en Windows 11). Tauri lo verifica al primer `tauri:dev`.
- **Ollama** (LLM local y embeddings de la memoria) y **Docker Desktop** (Letta y Whisper): necesarios para los hitos LLM, Memoria y STT (ver sus secciones).
- Python 3.11 solo si corres Whisper sin Docker.
- Hardware de referencia: un portátil con una GTX 1650 de 4 GB. La config por defecto (`qwen2.5:3b`, Whisper `small` en `int8`, avatar a 30 fps) está pensada para él.

## Setup local

```bash
# Clonar y entrar
git clone https://github.com/Pipelol0723/proyecto-shiro.git
cd proyecto-shiro

# Asegurarse de estar en develop
git checkout develop

# Instalar dependencias (npm instala todos los workspaces)
npm install

# Compilar core primero: core-host y desktop importan sus tipos desde packages/core/dist
npm run build -w @proyecto-shiro/core

# Verificar que todo compila
npm run typecheck

# Ejecutar tests
npm test
```

## Arrancar la app como binario nativo (Tauri)

Tras el hito Packaging (ADR 0024), el cliente desktop se ejecuta dentro
de un binario Tauri 2.0 con tray icon y close-to-tray. Para arrancarlo
en modo dev:

```bash
# Los iconos ya están commiteados en packages/desktop/src-tauri/icons/.
# Solo si cambias el logo: npx @tauri-apps/cli icon <png-cuadrado> (los sobrescribe; ver su README)

# Arrancar Tauri (esto compila Rust la primera vez — ~3-5 min)
npm run tauri:dev -w @proyecto-shiro/desktop
```

Tauri arranca Vite por debajo y abre la ventana cuando todo está listo.
La X de la ventana minimiza al tray; para salir realmente, click derecho
en el tray icon → Salir.

### El `core-host` viaja como sidecar

Desde el PR del sidecar (ADR 0024 §2), el binario empaquetado **lanza el
`core-host` por su cuenta** — no hace falta abrir una terminal aparte. El
proceso Node se empaqueta como `.exe` y Tauri lo arranca al abrir y lo
mata al salir.

Para construir el sidecar (necesario antes de `tauri:build`, y para que
`tauri:dev` lo lance en lugar de pedirte el core-host a mano):

```bash
# 1. Compila core + core-host (el sidecar bundlea el JS ya compilado)
npm run build -w @proyecto-shiro/core -w @proyecto-shiro/core-host

# 2. Empaqueta el core-host como .exe + copia el binario nativo de SQLite
#    y las configs YAML a src-tauri/binaries|resources/
npm run build:sidecar -w @proyecto-shiro/desktop
```

La primera vez `pkg` descarga el runtime base de Node (~40 MB, cacheado).
El resultado queda en `packages/desktop/src-tauri/binaries/` (gitignored;
se reconstruye en cada release).

**En `tauri:dev`** el `beforeDevCommand` arranca **solo Vite** — el
`core-host` lo provee el sidecar, no un segundo proceso. Por eso:

- Si corriste `build:sidecar`, Tauri lanza el sidecar empaquetado (que **no**
  hereda el `.env` de la raíz: sus keys salen de su propio entorno o del
  `secrets.env` que escribe el setup wizard — ver el bloque de API keys abajo).
- Si NO lo corriste, no hay `core-host`: arráncalo a mano en otra terminal
  con `npm run dev -w @proyecto-shiro/core-host` y el cliente se conecta por
  WS igual.

> Antes el `beforeDevCommand` levantaba también un `core-host` con `tsx`,
> que chocaba con el sidecar por el puerto `9876` (`EADDRINUSE`) y hacía que
> la app leyera las keys del `.env` en vez del `secrets.env`. Ya no: en
> `tauri:dev` solo corre el sidecar. (Y si dos `core-host` coinciden, el que
> llega tarde se aparta en silencio en lugar de crashear.)

> **API keys en modo empaquetado**: el binario no tiene un `.env` al lado,
> así que las keys se introducen **desde la app** — pantalla **Setup** →
> sección _API keys_ → pega tu `ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY` /
> `GEMINI_API_KEY` y Guardar. El core-host las persiste en un `secrets.env` en el dir de datos
> del usuario; **reinicia Shiro** (tray → Salir y reabrir) para aplicarlas.
> En `npm run dev` el `.env` de la raíz tiene prioridad. Ver ADR 0024 §6.

Para producir el `.msi` distribuible (requiere el sidecar ya construido):

```bash
npm run build:sidecar -w @proyecto-shiro/desktop   # si no lo hiciste ya
npm run tauri:build -w @proyecto-shiro/desktop
```

El binario sale en `packages/desktop/src-tauri/target/release/bundle/msi/`.

### Cortar un release (CI firmado)

El workflow `.github/workflows/release.yml` construye el binario Windows
**firmado** y lo publica como Release en GitHub (con los artefactos del
auto-updater). Se dispara al pushear un tag de versión.

> El único release, v0.1.0, sigue en **borrador**: el auto-updater existe pero
> nunca ha servido una actualización. Las versiones son tags `vX.Y.Z` sobre
> `develop` y no se corta ninguno nuevo sin la checklist pre-release de
> [ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md) (ver
> [`CONTRIBUTING.md`](CONTRIBUTING.md)).

```bash
# Sube la versión en packages/desktop/src-tauri/tauri.conf.json y Cargo.toml,
# luego:
git tag vX.Y.Z
git push origin vX.Y.Z
```

El CI deja el Release como **borrador**: revisa los assets (`.msi`, `.exe`,
`latest.json`) y **publícalo a mano** para que el auto-updater lo vea
(lee `releases/latest`). Requiere el secret `TAURI_SIGNING_PRIVATE_KEY`
configurado — ver [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Arrancar la app (modo dev sin binario — solo navegador)

Desde ADR 0012, el companion se reparte en **dos procesos**: el servidor
Node (`@proyecto-shiro/core-host`) que tiene los módulos LLM/Router/etc.
y el cliente desktop (`@proyecto-shiro/desktop`) que pinta la UI. Hablan
por WebSocket.

```bash
# Arranca ambos en paralelo (concurrently)
npm run dev
```

El cliente abre `http://localhost:5173` en el navegador y se conecta a
`ws://localhost:9876/bus`. Si el server tarda en arrancar, el cliente
reintenta con backoff exponencial — verás logs de reconexión.

Para arrancar solo uno:

```bash
npm run dev -w @proyecto-shiro/core-host   # solo el server
npm run dev -w @proyecto-shiro/desktop     # solo el cliente
```

Configurable por env (ver `.env.example`):

- `ANTHROPIC_API_KEY` — sin esto, el slot cloud no responde y el `HybridRouter` cae a Ollama solo. Conseguir una key en [console.anthropic.com](https://console.anthropic.com).
- `ELEVENLABS_API_KEY` — voz neuronal; sin ella todo sale por SystemTTS (o por Gemini si lo activas)
- `GEMINI_API_KEY` — voz diseñada de Gemini; solo se usa si activas la cadena con Gemini ([guía](#voz-de-gemini-probarla-y-pasar-al-nivel-de-pago)); sin ella esa cadena sigue con ElevenLabs y luego con SystemTTS
- `LETTA_SERVER_PASSWORD` — ver [Memoria](#requisitos-para-el-hito-memoria-letta)
- `SHIRO_HOST_PORT` — puerto del WS (default 9876)
- `VITE_SHIRO_HOST_URL` — URL que usa el cliente (default `ws://localhost:9876/bus`)
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error`
- `SHIRO_MODULES_CONFIG` — ruta al YAML de módulos (default `../../config/modules.config.yaml`, relativa a `packages/core-host`)
- `SHIRO_CHARACTER` — ruta al YAML del personaje (default `../core/src/character/characters/default.yaml`)

El host de Ollama no se lee del entorno: sale de `llm.local.config.host` en
`config/modules.config.yaml`. Las variables `WHISPER_*` las lee docker-compose
del mismo `.env` (ver STT).

El `.env` se carga automáticamente al arrancar el server (flag `--env-file-if-exists` en el script `dev`). Copia `.env.example` a `.env` y rellena.

### Requisitos para el hito LLM

- **Ollama** corriendo en `localhost:11434` con `qwen2.5:3b` descargado (`ollama pull qwen2.5:3b`). Para GPUs con más VRAM, sube a `:7b` o `:14b` editando `config/modules.config.yaml`.
- **Anthropic API key** (opcional pero recomendada para que el `HybridRouter` pueda escalar a Claude en preguntas complejas).

### Requisitos para el hito Memoria (Letta)

La memoria persistente usa **Letta** (Docker) como almacén canónico, con embeddings **locales vía Ollama** (sin nube, sin API key) sobre el SDK oficial `@letta-ai/letta-client`. Ver [ADR 0017](docs/adr/0017-memoria-persistente-local-y-letta.md) y [ADR 0018](docs/adr/0018-letta-sdk-oficial-embeddings-ollama.md).

Para activarla:

1. **Descarga el modelo de embeddings** en Ollama (obligatorio — archival memory lo exige):

   ```bash
   ollama pull mxbai-embed-large
   ```

2. **Pon una password de Letta** en `.env` (la misma var configura el server y el cliente):

   ```bash
   LETTA_SERVER_PASSWORD=elige-una-cadena-secreta
   ```

3. **Arranca Letta** (servicio de larga vida, aparte de `npm run dev`):

   ```bash
   docker compose up -d letta
   ```

4. **Verifica** que responde:

   ```bash
   curl http://localhost:8283/v1/health/
   ```

Letta y Whisper se publican solo en esta máquina (`127.0.0.1`). `LETTA_BIND` y `WHISPER_BIND` los exponen a la red a sabiendas (Whisper no tiene autenticación). `docker compose up -d` a secas levanta solo Letta: Whisper tiene el perfil `stt` y arranca al nombrarlo (`docker compose up -d whisper`). La imagen de Letta está fijada por digest; antes de subirla, copia el volumen `letta_pgdata`.

El agente de Letta se **auto-provisiona** la primera vez que el `core-host` arranca con Letta arriba; su id se persiste en el WAL local (`./data/memory.db`). No hay que crearlo a mano ni pegar ids. El agente se crea con un `embedding_config` explícito hacia Ollama (ver `config/modules.config.yaml`, bloque `memory.letta`).

> **Embeddings**: la config apunta a la API OpenAI-compat de Ollama con `embedding_endpoint: http://host.docker.internal:11434/v1`. El sufijo `/v1` es **obligatorio** (sin él, Letta da `404 page not found` al embeber → 500 en cada turno). En Windows/macOS el contenedor llega al host por `host.docker.internal`, no `localhost`. Si cambias de modelo de embeddings, ajusta también `embedding_dim`. Esto funciona también contra un Letta que ya tengas corriendo, sin recrearlo.

> **Recall instantáneo**: Shiro pide a Ollama que mantenga 30 minutos el modelo con el que responde y clasifica. El de embeddings lo llama Letta y Ollama lo descarga tras ~5 min de inactividad, así que el primer recuerdo por parecido tras una pausa paga un _cold-start_ de varios segundos (no se pierde nada: lo reciente sale de la memoria local). Shiro hace un _warm-up_ del embedding al arrancar para que el recall semántico vaya fino desde el primer turno. Para recall siempre instantáneo aunque haya pausas, arranca Ollama con `OLLAMA_KEEP_ALIVE=-1` (mantiene los modelos cargados en memoria).

Si Letta no está corriendo, el companion **funciona igual**: los turnos se guardan en el WAL local (SQLite) y se drenan a Letta en cuanto vuelva. Cero turnos perdidos.

### Requisitos para el hito STT (Whisper)

La entrada de voz usa **faster-whisper** en un microservicio Python aparte (Docker). El cliente desktop captura PCM Int16 LE @ 16 kHz vía `AudioWorklet` y abre un WebSocket directo al microservicio (`ws://localhost:8765/stt`). El `core-host` no participa del audio. Ver [ADR 0019](docs/adr/0019-stt-faster-whisper-microservicio-python.md).

Para activarlo:

1. **Arranca el microservicio** (servicio de larga vida, aparte de `npm run dev`):

   ```bash
   docker compose up -d whisper
   ```

2. **Verifica** que cargó modelo y device:

   ```bash
   docker compose logs whisper --tail 20
   curl http://localhost:8765/health
   ```

   Deberías ver `device resuelto: cuda` (si tu Docker Desktop expone la GPU) o `cpu`.

3. **Hablar a Shiro**: en la pantalla de Conversación del desktop, mantén pulsado `Space` (o el botón del micro) y habla. Al soltar, la transcripción entra al chat como turno del usuario y Shiro responde.

**Sin GPU**: el contenedor cae a CPU automáticamente y la latencia se multiplica (~2-4× tiempo real con `small` y `int8`). En `.env` pon `WHISPER_DEVICE=cpu` y `WHISPER_COMPUTE_TYPE=int8`; y comenta la sección `deploy: resources` del `docker-compose.yml` para que arranque sin pedir GPU.

**Tunings disponibles** (todos opcionales en `.env`, defaults en el compose):

| Variable                      | Default compose | Para qué                                                                                         |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `WHISPER_MODEL`               | `small`         | Sube a `large-v3` cuando tengas Tensor Cores (RTX 2060+).                                        |
| `WHISPER_COMPUTE_TYPE`        | `int8`          | Con Tensor Cores cambia a `int8_float16` para ~2× speedup. En GPUs Pascal (GTX 10xx) usa `int8`. |
| `WHISPER_PARTIAL_INTERVAL_MS` | `2500`          | Cuánto tarda en emitir partials. Bajar gasta más CPU/GPU; subir te da subtítulos más lentos.     |
| `WHISPER_HOTWORDS`            | `Shiro`         | Palabras clave que el decoder boostea (separadas por espacios). Útil para nombres propios.       |

Ver `services/whisper/README.md` para detalles del microservicio.

### Requisitos para el hito TTS (ElevenLabs y cadena de voz)

La cadena de voz es configurable ([ADR 0034](docs/adr/0034-tts-gemini-voz-disenada.md)). Por defecto (`tts.active: ElevenLabsTTS`) usa **ElevenLabs** como primary y **SystemTTS** (voz del SO via `say.js`) como fallback. Con Gemini activada pasa a **Gemini → ElevenLabs → SystemTTS**: ver la [guía de Gemini](#voz-de-gemini-probarla-y-pasar-al-nivel-de-pago). Todos corren in-process en el `core-host` (no hay microservicio aparte — ver [ADR 0020](docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)).

Para activarlo:

1. **API key de ElevenLabs** en `.env` (raíz del repo, NO en `packages/core-host/.env`):

   ```bash
   ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
   ```

   Cuídate de:
   - El nombre exacto es `ELEVENLABS_API_KEY` (sin guión bajo entre "eleven" y "labs").
   - **Sin comillas** alrededor del valor.
   - **Sin espacios** alrededor del `=`.

   Si la key no está, el `core-host` arranca igual con un `WARN` esperado y todos los turnos salen por SystemTTS (voz nativa del OS).

2. **Voice ID** en `config/modules.config.yaml` (slot `tts.config.voice_id`):

   ```yaml
   tts:
     config:
       voice_id: '<id de tu voz de ElevenLabs>'
   ```

   El catálogo está en <https://elevenlabs.io/app/voice-library>. Filtra por idioma y estilo; copia el `voice_id` del detalle. Si tu voice fue diseñada (Voice Design / Voice Remix), está en "My Voices".

3. **(Linux solamente, opcional)** Instala `festival` o `espeak` para que el fallback SystemTTS funcione. En Windows y macOS no se requiere instalación extra (SAPI / NSSpeechSynthesizer son nativos).

**Cómo verificarlo en logs**:

```
[bootstrap] TTS cadena: tts:chain:tts:elevenlabs:<voice_id>→tts:system
```

Si la cadena dice `tts:chain:tts:elevenlabs:<voice_id>→tts:system`, todo cableado. Cuando hables con Shiro:

- Si oyes voz neuronal natural → ElevenLabs está activo.
- Si oyes voz sintética del SO (Microsoft Aria en Windows) → ElevenLabs cayó al fallback (revisa la API key).

**Tunings disponibles** (en `config/modules.config.yaml`, slot `tts.config`):

| Variable            | Default                  | Para qué                                                                    |
| ------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `voice_id`          | `''` (vacío)             | Voz de ElevenLabs. Sin esto, el primary falla y cae a SystemTTS.            |
| `model_id`          | `eleven_multilingual_v2` | Modelo de ElevenLabs. `eleven_turbo_v2_5` para latencia más baja.           |
| `similarity_boost`  | `0.78`                   | 0-1. Más alto = más fiel a la voz elegida.                                  |
| `style`             | `0.15`                   | 0-1. Exageración. Bajo a propósito para Shiro (kuudere, no exagera).        |
| `use_speaker_boost` | `true`                   | Mejora la claridad sin tocar timbre.                                        |
| `default_stability` | `0.75`                   | Cuando no hay mapeo de emoción en `default.yaml` para una emoción concreta. |
| `timeout_ms`        | `30000`                  | Timeout HTTP. Frases cortas tardan <2s en GPU/Cloud; 30s deja margen.       |

El **`stability` por turno** lo lee el TTS del bloque `emotions:` del character YAML (`packages/core/src/character/characters/default.yaml`) en lugar de la config global — eso hace que la voz varíe entre emociones según el personaje. Gemini usa en su lugar `tts_style`, una frase de estilo en inglés por emoción (mismo bloque `emotions:`); si falta, no envía estilo.

**Ajustes de `GeminiTTS`** (solo con la cadena de Gemini activa; van en `tts.config`, y en `tts.providers.GeminiTTS` si es respaldo):

| Variable               | Default                | Para qué                                                                                               |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `voice_id`             | —                      | Voz diseñada (`voice_…`); la da `npm run voices -- create`.                                            |
| `model_id`             | `gemini-3.8-flash-tts` | Modelo de voz. Una voz queda ligada al modelo con que se creó.                                         |
| `timeout_ms`           | `30000`                | Tiempo máximo por petición; pasado, la cadena sigue con el siguiente eslabón.                          |
| `monthly_warn_seconds` | `6000`                 | Aviso en el log al pasar estos segundos sintetizados en el mes (100 min). Solo cuenta lo que ve Shiro. |

**Cancelable mid-speech**: si interrumpes a Shiro (apretas el mic durante speaking, o tipeas Enter), el audio actual se corta y arranca el nuevo turno.

**Varios clientes**: hoy todos los clientes conectados reciben `tts:audio` y lo reproducen, salvo los que tengan el mute activo (cada uno lo guarda en `localStorage`). No hay lógica de «primer cliente». El enrutado por cliente de origen lo decide el `OutputRouter` de [ADR 0026 §6](docs/adr/0026-estacion-holografica-pepper-ghost-cliente-ligero.md), sin implementar.

### Voz de Gemini: probarla y pasar al nivel de pago

La voz de Shiro de [ADR 0034](docs/adr/0034-tts-gemini-voz-disenada.md) es una voz diseñada de Gemini. **No es la voz por defecto**: `tts.active` sigue en `ElevenLabsTTS` y se activa a mano, primero con el nivel gratuito para probar y después, si compensa, con el de pago.

#### A. Probarla con el nivel gratuito

1. **Clave**: créala en [Google AI Studio](https://aistudio.google.com/apikey) y ponla como `GEMINI_API_KEY=` en `.env` (raíz del repo), o pégala en la pantalla **Setup** → _API keys_ (modo empaquetado, y reinicia).
2. **Comprobar o crear la voz**: con la clave en el entorno, `npm run voices -- get <id>` muestra la voz y los días que le quedan (código de salida 1 si está caducada, no existe o le quedan menos de 30). Para no escribir la clave en la terminal: `node --env-file=.env scripts/gemini-voices.mjs get <id>`. Si no la tienes, `npm run voices -- create --yes` la crea con la receta del repo (consume cuota y puede sonar distinta; `--dry-run` solo enseña la petición). Guarda los clips de referencia de la prueba **fuera del repo y con copia**.
3. **Activarla en una copia local de la configuración**: copia `config/modules.config.yaml` a un archivo tuyo fuera del repo y, en la copia, sustituye el bloque `tts:` por el ejemplo comentado entre `EJEMPLO-GEMINI-INICIO` y `EJEMPLO-GEMINI-FIN` (Gemini activa, ElevenLabs y la voz del sistema detrás). Pon el `voice_id` de Gemini del paso 2 y el de ElevenLabs en `providers.ElevenLabsTTS`. Apunta a la copia con `SHIRO_MODULES_CONFIG=<ruta absoluta de la copia>` en `.env` y reinicia (`SHIRO_MODULES_CONFIG` vale para `npm run dev`). El log del arranque debe mostrar la cadena `TTS cadena: …` con Gemini primero.
4. **Qué esperar**: el nivel gratuito da unas **10 frases al día** (límite visto en una prueba real, no publicado por Google); sirve solo para desarrollo y pruebas. Al agotarse, la cadena sigue con ElevenLabs y luego con la voz del sistema. **Privacidad**: con una clave gratuita, Google usa lo que Shiro dice en voz alta para mejorar sus productos.
5. **Latencia**: en pruebas reales una frase corta tardó entre 3,5 y 4,2 s con Gemini, y alrededor de 1 s con ElevenLabs; es una medida, no una garantía.

#### B. Pasar al nivel de pago

Datos leídos en la documentación de Google el 2026-11-13; los nombres de pantalla están en inglés. Revísalos si Google cambia la interfaz.

1. **Alerta de presupuesto, ANTES de activar el pago.** La API de pago no tiene tope de gasto. Un presupuesto cuelga de una cuenta de facturación de Google Cloud: si no tienes ninguna, créala primero en Google Cloud Console → Billing, sin vincularla todavía al proyecto de la clave. Después, en Billing → _Budgets & alerts_ → _Create budget_ → _Alerts only_: periodo mensual, tu importe y umbrales del 50, 90 y 100 %. **Solo avisa por correo, no corta el gasto.** El tope _Monthly spend cap_ de la página _Spend_ de AI Studio sí limita, pero es experimental: Google admite sobrecostes por el retraso de los datos.
2. **Activar la facturación**: en AI Studio, página _API keys_ o _Projects_, localiza el proyecto de tu clave (columna _Billing Tier_ en _Free_) y pulsa _Set up billing_. Elige la cuenta de facturación del paso 1 (vincularla es lo que activa el pago); según el caso Google pide prepago (mínimo 5 USD) o cobra a fin de mes. El paso a _Tier 1_ suele ser inmediato, o tarda hasta unos 10 minutos. Con prepago, al llegar el saldo a 0 las peticiones fallan (HTTP 402) y la cadena sigue con ElevenLabs.
3. **La clave no cambia**: hereda el nivel de su proyecto. Comprueba el nivel en _Projects_ → _Billing Tier_.
4. **Probar una frase con la voz elegida.** Que la voz guardada siga sirviendo al activar el pago no está escrito en la documentación (es lo esperable, porque la voz vive en el proyecto): compruébalo con `npm run voices -- get <id>` y hablando con Shiro.
5. **Dejar la cadena fija**: pasa a `config/modules.config.yaml` el bloque de tres eslabones (`tts.active: GeminiTTS`, con la configuración de ElevenLabs, `voice_id` incluido, en `providers.ElevenLabsTTS`) y reinicia. Quita `SHIRO_MODULES_CONFIG` si usabas una copia.
6. **Probar los dos saltos**: sin `GEMINI_API_KEY` debe hablar ElevenLabs; sin red, la voz del sistema. Prueba ElevenLabs de vez en cuando para que el respaldo no se pudra.
7. **Medir una respuesta larga** y ajusta `timeout_ms` si la espera molesta: el peor caso en serie suma 30 s (Gemini) + 30 s (ElevenLabs) + 15 s (voz del sistema).
8. **Vigilar el gasto y la caducidad.** `monthly_warn_seconds` (por defecto 6000 s, 100 min) avisa en el log, pero solo ve lo que sintetiza Shiro, y su mes es en hora local: manda la alerta de Google (y no ve el límite de 10 peticiones al día del nivel gratuito).

**Qué cambia al pagar**: el contenido ya no lo usa Google para mejorar sus productos (en el nivel gratuito, sí), y el tope de unas 10 frases al día era del nivel gratuito; Google no publica los límites del nivel de pago para este modelo, míralos en la página de límites de AI Studio.

| Voz al mes                    | Hasta el 2026-12-31 | Desde el 2027-01-01 |
| ----------------------------- | ------------------- | ------------------- |
| 30 minutos                    | 0,41 USD            | 0,81 USD            |
| 100 minutos (el uso previsto) | 1,35 USD            | 2,70 USD            |
| 900 minutos (media hora/día)  | 12,15 USD           | 24,30 USD           |

El precio de `gemini-3.8-flash-tts` por millón de tokens es de 0,50 USD (texto) y 9 USD (audio) hasta el 2026-12-31, y de 1 USD y 18 USD desde el 2027-01-01; un segundo de audio son 25 tokens. Los textos suman céntimos.

**Caducidad de la voz**: una voz guardada dura un año (200 por proyecto). Google no documenta si el año cuenta desde la creación o desde el último uso; en la voz elegida se observó que usarla renovó la fecha, pero es una observación que Google puede cambiar, así que no cuentes con ello. La fecha vigente de tu voz la dice `npm run voices -- get <id>` (la elegida se creó el 2026-11-13); vigílala con el aviso del arranque (`Voz de Gemini …` en el log), el campo `geminiVoice` del informe de salud y `npm run voices -- get <id>`. Si pasa meses apagada, recréala antes con `npm run voices -- create --yes` y **escucha la nueva antes de cambiar el `voice_id`**.

### Requisitos para el hito Avatar Live2D

El avatar visual usa **`pixi-live2d-display-lipsyncpatch`** (fork mantenido de `pixi-live2d-display`, sobre **PixiJS v7**) renderizando el modelo dentro del componente `<Avatar>`. Si el SDK o el modelo no están instalados, `<Avatar>` cae al `<Orb>` (ADR 0009) automáticamente — el companion sigue 100% funcional sin avatar visual. La boca del modelo hace **lip-sync** con la voz del TTS. Ver [ADR 0021](docs/adr/0021-avatar-live2d-pixi-display-fallback-orbe.md). Live2D es uno de los motores del avatar ([ADR 0028](docs/adr/0028-avatar-motores-y-manifiesto.md)): `<Avatar>` prueba una lista de modelos en orden, primero el Live2D y después la [chibi por capas](#avatar-chibi-por-capas), y monta el primero que esté instalado.

> ⚠️ **Versión del Cubism Core: usa el SDK 4 (Core 4.2.2), NO el 5.** El Cubism Core que trae el "Cubism SDK for Web **5**" reporta versión **6.0.1** y **crashea el renderer** (`Cannot read properties of undefined (reading '0')` en `doDrawModel`) con `pixi-live2d-display-lipsyncpatch`. Usa el **Cubism SDK for Web 4** (release 4-r.x), cuyo Core es **4.2.2** y sí funciona. El Core está gitignored y cada dev baja el suyo, así que es fácil de equivocar — si ves ese crash, casi seguro tienes un Core demasiado nuevo.

**Lo propietario (no entra al repo)**:

1. **Cubism Core SDK Web** (`live2dcubismcore.js`, **versión 4.2.2**):
   - Baja el ZIP **"Cubism SDK for Web 4"** desde <https://www.live2d.com/sdk/download/web/> (sección de versiones anteriores / SDK 4).
   - Copia `Core/live2dcubismcore.js` a:

     ```
     packages/desktop/public/live2d/Core/live2dcubismcore.js
     ```

   - Confirma la versión en la consola del navegador al arrancar: debe decir `Live2D Cubism SDK Core Version 4.2.x`. Si dice `6.0.1`, es el Core del SDK 5 y crasheará.

2. **Modelo Hiyori** (placeholder hasta tener uno definitivo): viene dentro del mismo ZIP del SDK, en una carpeta `Resources/Hiyori/` (la ruta exacta varía por versión del SDK).
   - Copia la carpeta entera a:

     ```
     packages/desktop/public/live2d/models/Hiyori/
     ```

   - La estructura final dentro de `Hiyori/` debe contener al menos `Hiyori.model3.json`, `Hiyori.moc3`, `motions/*.motion3.json`, y las texturas (`Hiyori.2048/`).

**Verificación**: arranca el cliente desktop (`npm run dev -w @proyecto-shiro/desktop`). Si ves a Hiyori en lugar del orbe, todo está cableado; háblale y la boca se moverá con su voz. Si sigues viendo el orbe, abre la consola del navegador: un 404 en `/live2d/Core/...` o `/live2d/models/Hiyori/...` te dice qué falta; un crash de `doDrawModel` significa Core incompatible (ver el aviso de arriba).

**Tuneables** (en `config/modules.config.yaml`, slot `avatar.config`):

| Variable          | Default                                    | Para qué                                                                                                                           |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `model_path`      | `/live2d/models/Hiyori/Hiyori.model3.json` | URL del `.model3.json`. Cámbialo cuando bajes el modelo definitivo de Shiro.                                                       |
| `cubism_core_url` | `/live2d/Core/live2dcubismcore.js`         | URL del Cubism Core JS (versión **4.2.2** — ver aviso arriba).                                                                     |
| `max_fps`         | `30`                                       | Cap del render. 30 para la GTX 1650; súbelo a 60 cuando haya una GPU con más VRAM.                                                 |
| `idle_animation`  | `false`                                    | Motions idle de cuerpo. **OFF por default**: tocan `ParamMouthOpenY` y compiten con el lip-sync. El modelo igual respira/parpadea. |
| `idle_expression` | `idle`                                     | Expresión por defecto. Para Hiyori se traduce a `default` via alias en el código.                                                  |

**Lip-sync** (ADR 0021 §5): la boca (`ParamMouthOpenY`) se mueve analizando con Web Audio API el mismo `HTMLAudioElement` que reproduce el TTS — cero coste de red y sincronización exacta. En mute no hay lip-sync (boca cerrada).

**Expresiones** (ADR 0021 §6): la cara refleja la emoción de la respuesta de Shiro (`llm:responded { emotion }`) interpolando parámetros faciales Cubism (`ParamMouthForm`, cejas, mejillas, ojos sonrientes). Hiyori no trae archivos `.exp3.json`, así que se usan parámetros directos; el seam para `model.expression()` queda listo en `expression-map.ts`. La _precisión_ de la emoción depende del LLM (Qwen 3b local clasifica mal; Claude o un modelo local mayor lo hacen mucho mejor) — el avatar refleja fielmente la emoción que recibe.

**Disonancia visual del placeholder**: Hiyori es expresiva y cute; Shiro es kuudere y reservada. Esta disonancia es **deuda explícita** hasta que llegue el modelo definitivo. El mapeo provisional `emoción Shiro → expresión Hiyori` vive en `packages/core/src/modules/avatar/hiyori-expression-aliases.ts` y desaparece cuando el modelo definitivo tenga expresiones alineadas con el YAML del personaje (`idle`, `smirk`, `thinking`, `annoyed`, `soft`).

### Avatar chibi por capas

Shiro tiene un segundo motor de avatar, más ligero que Live2D: una figura hecha de imágenes apiladas (cuerpo, ojos, boca, cejas, brillo) que se dibuja en un canvas 2D, sin SDK ni dependencias. Habla, parpadea, cambia de expresión con la emoción de la respuesta y mueve la mirada. Ver [ADR 0028](docs/adr/0028-avatar-motores-y-manifiesto.md) §4.

**Dónde va el modelo.** Un modelo es una carpeta con un `avatar.manifest.json` y sus imágenes:

```
packages/desktop/public/avatar/models/shiro-chibi/
├── avatar.manifest.json
└── assets/…
```

La carpeta `public/avatar/models/` no se versiona: las imágenes de Shiro salen del arte original del personaje. Se generan con los scripts de [`docs/design/chibi-prototype/`](docs/design/chibi-prototype/README.md), que también describe el formato del manifiesto.

**Probarlo sin las imágenes de Shiro.** El repo trae un modelo sintético (formas de color, sin arte del personaje) con el que se prueba el motor. Copia `assets/` y `avatar.manifest.json` de `docs/design/chibi-prototype/test-model/` a la carpeta de arriba. En bash:

```bash
mkdir -p packages/desktop/public/avatar/models/shiro-chibi
cp -r docs/design/chibi-prototype/test-model/assets \
      docs/design/chibi-prototype/test-model/avatar.manifest.json \
      packages/desktop/public/avatar/models/shiro-chibi/
```

**Qué modelo sale.** `<Avatar>` prueba los modelos en orden y monta el primero disponible: Live2D, después la chibi y, si no hay ninguno, el orbe. Con Hiyori instalada sale Hiyori; para ver la chibi, hoy hay que no tener el modelo Live2D en `public/live2d/models/`. Elegir modelo desde la app es el paso siguiente de la [hoja de ruta](#roadmap).

**Si sale el orbe.** Abre la consola del navegador: el motor dice qué le pasa al modelo en una línea que empieza por `[Avatar]` (una imagen que falta, una que no mide lo que dice el manifiesto, o un campo del manifiesto que no vale). Si no dice nada, es que no encontró el manifiesto. Un modelo es todo o nada: con una sola imagen mal, no se muestra.

## Scripts disponibles (desde la raíz)

| Comando                                         | Descripción                                              |
| ----------------------------------------------- | -------------------------------------------------------- |
| `npm run build`                                 | Compila todos los workspaces (`tsc` por paquete)         |
| `npm run typecheck`                             | Verifica tipos en todos los paquetes                     |
| `npm test`                                      | Ejecuta tests vía Vitest workspace                       |
| `npm run test:watch`                            | Tests en modo watch                                      |
| `npm run test:coverage`                         | Tests con reporte de cobertura                           |
| `npm run test:coverage -w @proyecto-shiro/core` | Cobertura de core con sus umbrales (lo que aplica el CI) |
| `npm run lint`                                  | Lintea todo el monorepo con ESLint                       |
| `npm run lint:fix`                              | Lintea y arregla lo automatizable                        |
| `npm run format`                                | Formatea con Prettier (todos los paquetes)               |
| `npm run format:check`                          | Verifica formato sin escribir (lo que usa el CI)         |
| `npm run verify`                                | Todos los checks del CI, en orden                        |
| `npm run test:scripts`                          | Tests de los scripts de la raíz (`node --test`)          |
| `npm run audit:prod`                            | Audit de producción: falla con high o critical           |
| `npm run agents:sync`                           | Regenera AGENTS.md desde los bloques de CLAUDE.md        |
| `npm run agents:check`                          | Falla si AGENTS.md no coincide con CLAUDE.md             |

Para ejecutar un script solo en un paquete:

```bash
npm run typecheck -w @proyecto-shiro/core
npx vitest run --project core
```

Los paquetes no tienen script `test` propio; los proyectos de Vitest son
`core`, `core-host` y `desktop`. El typecheck de `core-host` y `desktop`
necesita `packages/core/dist`: compila core antes.

## Cómo correr los tests y checks

Hay dos niveles de prueba: los **checks automáticos** (lo que valida el
CI) y la **verificación manual** de cambios con UI o I/O real.

### 1. Checks automáticos — antes de cada push

Un solo comando ejecuta los mismos pasos que corre el CI, en el mismo
orden, y se detiene en el primero que falla. Si falla, **no pushees**:
arregla primero.

```bash
npm run verify
```

Por dentro son estos ocho pasos, que también puedes lanzar sueltos:

```bash
npm run build -w @proyecto-shiro/core   # tipos de core para el resto (dist no se versiona)
npm run format:check   # formato (Prettier)
npm run lint           # ESLint en todo el monorepo
npm run typecheck      # TypeScript en core, core-host y desktop
npm test               # Vitest — toda la suite
npm run build          # compila los tres paquetes
npm run test:scripts   # tests de los scripts de la raíz (node --test)
npm run agents:check   # AGENTS.md coincide con lo que genera CLAUDE.md (si no: npm run agents:sync)
```

El CI ejecuta además `npm run audit:prod`, que falla si una dependencia de
producción tiene un aviso `high` o `critical` sin una excepción vigente en
`scripts/audit-exceptions.json`. Necesita red, por eso no forma parte de
`verify`. También aplica la cobertura de core
(`npm run test:coverage -w @proyecto-shiro/core`: falla por debajo de 80 % de
líneas, funciones y sentencias, o de 75 % de ramas) y repite `verify` en
Windows en el job `verify-windows`, que todavía no es obligatorio para fusionar.

Atajo para arreglar formato y lint automáticamente antes de revisar:

```bash
npm run format         # reescribe con Prettier
npm run lint:fix       # arregla lo que ESLint pueda solo
```

### 2. Correr un solo test (iterar rápido)

`npm test` corre todo (~45 s). Para enfocarte en un archivo, filtra por
nombre (substring del path del test):

```bash
npm test -- system-health     # solo el healthcheck del sistema
npm test -- useTtsPlayback     # solo el hook de reproducción TTS
npm test -- local-memory       # solo el WAL de memoria
```

Modo watch (re-corre al guardar — ideal mientras desarrollas):

```bash
npm run test:watch
```

Cobertura (qué líneas tocan los tests):

```bash
npm run test:coverage
```

### 3. Verificación manual (UI + servicios reales)

Los tests automáticos cubren la lógica, pero lo que renderiza el
navegador o depende de servicios externos (LLM, voz, avatar) se prueba
levantando la app. WebGL y el audio real no corren en jsdom, así que el
render del avatar, el lip-sync y el wizard de salud se verifican a mano:

```bash
# Las dos partes a la vez (server + cliente)
npm run dev
```

Luego en el navegador (`http://localhost:5173`):

- **Pantalla Setup** → el wizard muestra en verde/rojo qué servicios
  (Ollama, Letta, Whisper) están arriba y si las API keys están
  presentes, con el comando para levantar lo que falte. El botón
  "rechequear" re-dispara el chequeo.
- **Conversación** → escribe o habla (push-to-talk con `Space`) y
  confirma que Shiro responde, el avatar mueve la boca y cambia de
  expresión.

Para probarlo ya como **binario nativo** (Tauri lanza el sidecar solo),
ver la sección [Arrancar la app como binario nativo](#arrancar-la-app-como-binario-nativo-tauri).

## Estructura del monorepo

```
proyecto-shiro/
├── packages/
│   ├── core/                       ← @proyecto-shiro/core (cerebro headless, browser-safe + entry Node)
│   │   ├── src/
│   │   │   ├── core/               ← EventBus, Orchestrator, ModuleLoader, Logger, transports
│   │   │   ├── config/             ← Schemas zod + ConfigLoader
│   │   │   ├── interfaces/         ← Contratos: ILLMModule, ITTSModule, etc.
│   │   │   ├── modules/            ← Implementaciones (stt, tts, llm, memory, avatar, router)
│   │   │   ├── plugins/            ← Features futuras (IoT, devices, etc.)
│   │   │   ├── character/          ← Definiciones de personaje YAML
│   │   │   └── types/              ← Emotion, EventMap
│   │   ├── tests/                  ← Unit + integration
│   │   └── …
│   │
│   ├── core-host/                  ← @proyecto-shiro/core-host (server Node, ADR 0012)
│   │   ├── src/                    ← Bootstrap del Orchestrator + servidor WebSocket
│   │   └── …
│   │
│   └── desktop/                    ← @proyecto-shiro/desktop (cliente Vite+React)
│       ├── src/                    ← React app: orbe + 5 pantallas + 3 temas
│       └── …
│
├── config/                         ← YAML editable (módulos activos, dispositivos)
│   ├── modules.config.yaml
│   └── devices.config.yaml
│
├── services/whisper/               ← Microservicio STT (Python + faster-whisper, ADR 0019)
├── docker-compose.yml              ← Letta y Whisper
│
├── docs/
│   ├── architecture.md             ← Arquitectura viva (fuente de verdad actual)
│   ├── adr/                        ← Architecture Decision Records (0001…)
│   ├── estacion-holografica.md     ← Plan de la estación holográfica
│   ├── security-review-2026-07.md  ← Revisión de seguridad y tabla viva SEC-xx
│   ├── revision-estado-2026-11.md  ← Revisión del estado (+ su anexo con las fichas)
│   ├── plan-mejora-2026-11.md      ← Plan de mejora
│   ├── design/                     ← Biblia del personaje y diseño
│   └── design-mockup/              ← Bundle de Claude Design (referencia, no código)
│
├── .github/workflows/              ← CI
├── tsconfig.base.json              ← Config TypeScript compartido
├── vitest.workspace.ts             ← Orquestador Vitest para todos los paquetes
├── eslint.config.js                ← Flat config para todo el monorepo
└── package.json                    ← workspaces: ["packages/*"]
```

### ¿Por qué monorepo?

Permite que el **cerebro (`core`) corra como servicio independiente** y múltiples
clientes (desktop, móvil futuro, Arduino bridge, etc.) lo consuman. Cada paquete
tiene su propio `package.json` con dependencias específicas, pero comparten
tooling (TS, ESLint, Prettier, Vitest) desde la raíz. Ver
[ADR 0002](docs/adr/0002-monorepo-npm-workspaces.md).

Futuros paquetes previstos: `@proyecto-shiro/mobile`, `@proyecto-shiro/arduino-bridge`,
`@proyecto-shiro/iot-bridge` y `@proyecto-shiro/station` (cliente de la estación
holográfica, ver [`docs/estacion-holografica.md`](docs/estacion-holografica.md)). Todos consumirán el `core` vía interfaces y se
conectarán al `core-host` por WebSocket (mismo patrón que el cliente desktop).

## Configuración

Los módulos activos se eligen en [config/modules.config.yaml](config/modules.config.yaml).
Cambiar de proveedor (p.ej. ElevenLabs → SystemTTS) es una sola línea. Ver
[ADR 0006](docs/adr/0006-config-validation-zod.md) sobre validación con zod.

El personaje se define en
[packages/core/src/character/characters/default.yaml](packages/core/src/character/characters/default.yaml).
La identidad visual y el tono del personaje están en la
[biblia del personaje](docs/design/shiro-character-bible.md).

## Flujo de trabajo

- `develop` → única rama de integración (rama por defecto). Todo entra por **Pull Request** pequeño hacia `develop`; nadie pushea directo, y la rama se borra al fusionar.
- Versiones: tags `vX.Y.Z` sobre `develop`.
- `main` no es una rama «estable»: solo avanza al publicar un tag. Hoy va unos 260 commits por detrás de `develop` porque aún no se ha publicado ninguna versión.
- `feat/<nombre>/<tarea>` → trabajo individual.
- Sin issue tracker: el seguimiento es la tabla [Roadmap](#roadmap), las casillas del plan de mejora y la tabla SEC-xx de la revisión de seguridad. Detalle en [ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md).

Convenciones de commit: `feat:`, `fix:`, `test:`, `docs:`, `refac:`, `chore:`, `ci:`.

## Avisos sobre dependencias propietarias

### Live2D Cubism SDK Web

El **Cubism Core** (`live2dcubismcore.js`) es propietario y **NO se commitea
al repo**. Cada desarrollador lo descarga manualmente desde
https://www.live2d.com/sdk/download/web/ (**SDK for Web 4**, Core **4.2.2** —
el del SDK 5 crashea el renderer). Instrucciones detalladas y la ruta exacta en
[Requisitos para el hito Avatar Live2D](#requisitos-para-el-hito-avatar-live2d).

### Modelos de avatar

Los archivos `.moc3` / `.model3.json` descargados de Booth.pm u otras
fuentes están sujetos a las licencias de sus respectivos autores. **No
los commitees** salvo que tengas autorización explícita.

Lo mismo vale para las imágenes de la chibi por capas: salen del arte
original del personaje y van en `packages/desktop/public/avatar/models/`,
que git ignora.

### API keys

Toda credencial (ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, GEMINI_API_KEY) va en `.env`,
nunca hardcodeada en el código ni commiteada. Plantilla en `.env.example`.

### Seguridad

Modelo de amenaza actual: **local, un solo usuario**. El bus y `/audio`
escuchan solo en `127.0.0.1` salvo `SHIRO_BIND_HOST` y rechazan un `Origin`
ajeno, pero todavía sin token; Whisper y Letta siguen escuchando en todas las
interfaces. La decisión vigente es
[ADR 0027](docs/adr/0027-autenticacion-token-bus-stt-multicliente.md) (token,
bind a `127.0.0.1` y Origin), Accepted y **en curso** (ver su enmienda del
2026-11-13); sustituyó al
[ADR 0025](docs/adr/0025-modelo-de-confianza-local-y-superficie-de-red.md),
que nunca se implementó. El estado de cada hallazgo vive en la tabla SEC-xx de
[`docs/security-review-2026-07.md`](docs/security-review-2026-07.md).

## Licencia

Por definir. Proyecto personal por ahora.
