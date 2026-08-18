# Instrucciones para Claude — Proyecto Shiro

Este archivo lo lee Claude Code automáticamente al iniciar una sesión
en este repo. Léelo entero antes de hacer cualquier cosa estructural.

## Qué es este proyecto

AI Companion modular tipo VTuber con voz, memoria y avatar animado.
Diseñado para escalar de app desktop a sistema con múltiples clientes
(móvil, Arduino, IoT, robots simples). Equipo de 2 personas, 4-6 h/semana.

**Lectura obligatoria antes de tomar decisiones arquitectónicas:**

- [`docs/architecture.md`](docs/architecture.md) — vista actual de la arquitectura, con diagramas mermaid.
- [`docs/adr/`](docs/adr/) — historial de decisiones con su porqué. Léelo cuando algo te haga dudar de "por qué se hizo así".
- [`docs/security-review-2026-07.md`](docs/security-review-2026-07.md) — revisión de seguridad transversal (2026-07) + [ADR 0025](docs/adr/0025-modelo-de-confianza-local-y-superficie-de-red.md) (modelo de confianza local). Léelo antes de tocar fronteras de confianza (auth, bind de red, permisos de tools, ACL de Tauri).
- [`plan-modular-ai-companion.md`](plan-modular-ai-companion.md) — plan y visión original (histórico).

## ⚠️ Cuándo escribir un ADR (no te lo saltes)

Antes de implementar algo que cumpla **AL MENOS UNA** de estas condiciones,
**pausa y propón al usuario escribir un ADR**:

1. Afecta a más de un módulo o paquete del monorepo.
2. Es difícil o caro de revertir.
3. Introduce o descarta una dependencia importante (librería nueva, servicio externo, formato de datos).
4. Establece un patrón que otros módulos seguirán (naming de eventos, esquema de config, convenciones de errores, etc.).
5. El usuario o su compañero, en 3 meses, preguntaría "¿por qué hicimos esto así?".

### Cómo crear un ADR

1. Copia `docs/adr/template.md` a `docs/adr/NNNN-titulo-en-kebab-case.md`,
   donde `NNNN` es el siguiente número libre con padding de 4 dígitos.
2. Rellena todas las secciones. La sección **"Alternativas consideradas"**
   es la más importante — ahí se ve el pensamiento.
3. Añade una fila en el índice de [`docs/adr/README.md`](docs/adr/README.md).
4. Commit junto al código que lo implementa, o como commit separado en el mismo PR.
   Mensaje sugerido: `docs: add ADR NNNN — <título corto>`.
5. Si supersede un ADR previo, cambia el `Status` del antiguo a `Superseded by NNNN`. No lo borres.

### Cuándo NO hace falta ADR

- Bugfixes locales sin cambio de patrón.
- Refactors cosméticos (renombrar variables, mover archivos).
- Tareas operativas (CI tweaks, bumps de dependencias menores, formato).
- Decisiones reversibles en menos de 30 minutos sin tocar otros módulos.

## Estructura del monorepo

```
packages/
├── core/        → @proyecto-shiro/core       (cerebro headless, browser-safe + entry Node)
├── core-host/   → @proyecto-shiro/core-host  (server Node, arranca el Orchestrator y expone WebSocket)
└── desktop/     → @proyecto-shiro/desktop    (cliente Vite + React + TS)

config/          → modules.config.yaml + devices.config.yaml (runtime)
docs/            → architecture.md + adr/ + design-mockup/
```

Paquetes previstos: `mobile`, `arduino-bridge`, `iot-bridge`. Todos
consumirán `@proyecto-shiro/core` como dependencia local y se conectarán
al `core-host` por WebSocket (mismo patrón que el cliente desktop).

### Orden de trabajo actualizado

El plan original (`plan-modular-ai-companion.md`) usaba numeración
Fase 0–7. A partir de [ADR 0008](docs/adr/0008-cliente-desktop-vite-react.md)
pasamos a **nombres** porque el cliente desktop se intercaló entre Core
y LLM:

1. **Setup** ✅ — monorepo, CI, ADRs, CLAUDE.md.
2. **Core** ✅ — EventBus, Orchestrator, ModuleLoader, 9 interfaces.
3. **Cliente desktop** ✅ — Vite + React + orbe + 3 temas + 5 pantallas + EventBus wiring (ahora via WebSocket).
4. **LLM** ✅ — split cliente/server (`core-host` proceso Node con WebSocketTransport), `OllamaLLM` (Qwen 2.5), `AnthropicLLM` (Claude Sonnet 4.6) con structured outputs, `HybridRouter` con clasificador LLM + fallback heurístico, pipeline conversacional cableado. Ver ADRs 0012-0016.
5. **Memoria** ✅ — Letta como almacén canónico (vía SDK oficial `@letta-ai/letta-client`) con embeddings locales en Ollama (`mxbai-embed-large`), `LocalMemory` SQLite como WAL + drainer, auto-provisión del agente y `memory:snapshot` para rehidratar el chat del desktop al reconectar. Ver [ADR 0017](docs/adr/0017-memoria-persistente-local-y-letta.md) y [ADR 0018](docs/adr/0018-letta-sdk-oficial-embeddings-ollama.md).
6. **STT** ✅ — microservicio Python con **faster-whisper** sobre CUDA (Docker + NVIDIA Container Toolkit, fallback CPU), captura PCM 16 kHz en el desktop vía AudioWorklet, push-to-talk con `Space` o click-and-hold, WebSocket directo cliente↔microservicio (el `core-host` no participa del audio — solo healthcheck `ping()` no bloqueante al arrancar), partials cada 2.5 s, `hotwords` para nombres propios, wiring `stt:transcribed → user:message` para unificar entrada texto/voz. Ver [ADR 0019](docs/adr/0019-stt-faster-whisper-microservicio-python.md).
7. **TTS** ✅ — cadena **ElevenLabs primary + SystemTTS fallback** in-process en `core-host` (sin microservicio aparte — ADR 0020). `TtsWithFallback` envuelve los dos como un solo `ITTSModule`. Audio generado server-side y servido por HTTP efímero (`GET /audio/<id>.<ext>`, TTL 60s) con CORS abierto; el cliente reproduce con `HTMLAudioElement` (`useTtsPlayback` hook) y emite `tts:audio-ended`. Mapeo emoción → `stability` desde el bloque `emotions:` del character YAML; el resto de `voice_settings` (similarity_boost, style, use_speaker_boost) son constantes en `modules.config.yaml`. Cancelable mid-speech (`tts:cancel` invalida el cache y para el audio). Toggle mute por cliente persistido en `localStorage` — multi-device "cliente activo" diferido a ADR futuro. Voz sintética/UTAU también diferida a hito post-5080 (será microservicio aparte, mismo patrón que Whisper). Ver [ADR 0020](docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md).
8. **Avatar Live2D** ✅ — render de Hiyori vía `pixi-live2d-display-lipsyncpatch` (PixiJS v7, Cubism Core **4.2.2** — el SDK 5/Core 6 crashea el renderer) dentro de `<Avatar>`, con fallback automático al orbe. **Lip-sync** de la boca con la voz del TTS (Web Audio → `ParamMouthOpenY`) y **expresiones faciales por emoción** (`llm:responded` → parámetros Cubism; seam listo para `model.expression()`). Idle off por default (sus motions competían con el lip-sync). La precisión de la emoción depende del LLM, no del avatar. Ver [ADR 0021](docs/adr/0021-avatar-live2d-pixi-display-fallback-orbe.md).
9. **Packaging Tauri** ✅ — Shiro empaquetado como binario **Tauri 2.0** para Windows x64 (doble-click). Bootstrap con tray icon, close-to-tray, single-instance; plugins fs/shell/dialog registrados pero runtime-denied vía ACL de capabilities (enmienda ADR 0024 §5). **Sidecar del core-host**: empaquetado con ncc+pkg (`build:sidecar`), `better-sqlite3.node` vía `nativeBinding`, lanzado/matado desde Rust con cwd fijado a `app_local_data_dir` (memoria estable) y configs por env var. **Setup wizard** (`system:health`) que chequea Ollama/Letta/Whisper + presencia de keys, con **entrada de API keys en runtime** (`secrets.env` en el data dir, escrito por el wizard y cargado al arrancar sin pisar `.env`/env vars reales). **Auto-updater** firmado ed25519 servido por GitHub Releases + workflow CI `release.yml` por tag `v*.*.*`. El state del chat vive en un `CompanionProvider` en el root (sobrevive a cambios de pantalla) y el `memory:snapshot` rehidrata al reconectar. **Modo overlay diferido a post-MVP**. Ver [ADR 0024](docs/adr/0024-packaging-tauri-windows-sidecar.md).
10. **Agentic tools** ✅ — Shiro pasa de interlocutora a **agente**: slot `tools:` en el orchestrator (`IToolsRegistry` de `IToolModule`), tools **Filesystem** (`fs:read`/`fs:list` auto, `fs:write`/`fs:delete` confirm) con `FsScope` (containment + anti-symlink desde YAML) y **Shell** (`shell:exec` confirm) con allowlist de comandos + args por regex. El pipeline corre un **loop tool-use** solo en el slot cloud (Claude); `AnthropicLLM.generateWithTools` itera LLM↔tools hasta el `respond` terminal. Las `confirm` pasan por un **`ApprovalGate`** que pausa el turno y emite `tool:requires-approval` → el cliente muestra el **modal de aprobación** (`tool:approval`, sin "remember"). Cada acción se persiste como turno **`role:'tool'`** en memoria (WAL + Letta por tags; migración in-place del CHECK de SQLite). El **`HybridRouter`** gana la dimensión `requires_tools` (fast-path determinista + flag del clasificador) que fuerza cloud, porque el local no hace tool-use fiable. Ver [ADR 0022](docs/adr/0022-shiro-agentic-tools-fs-shell.md).
11. **Self-improvement** ✅ — Shiro pasa de agente a **contribuidora de su propio repo** (propose-only, [ADR 0023](docs/adr/0023-shiro-self-improvement-propose-only.md)). Un `SelfDevSession` (`core-host/src/selfdev/`) orquesta el flujo determinista: la tool `selfdev:propose` (`confirm`) arranca una sesión en background que crea un **worktree git aislado** (`../shiro-selfdev`, rama `shiro/<topic>`, `node_modules` enlazado sin `npm ci`), corre un **sub-loop de generación** (`generateWithTools` con un registry fs scoped al worktree + **denylist de inmutables** hardcodeada: carácter, ADRs, `config/`, `safety/`, `.env*` → `IMMUTABLE_PATH`), pasa el **eval gate** (rebuild de `core` + `format:check`/`lint`/`typecheck`/`test`, con fix-loop acotado a `max_fix_iterations`) y —solo si está verde— commitea, pushea a `shiro/<topic>` y abre un **PR** vía `gh:pr-create` (allowlist hardcodeado a `gh pr create`), detrás de un segundo modal de aprobación con el diff. **Nunca** mergea, pushea a develop/main, ni toca inmutables (`git push` acotado por regex a `shiro/…`). **Dev-only** (auto-detecta repo + git/gh; apagado en el binario). Eventos `selfdev:progress`/`selfdev:done` → panel `SelfDevStatus` en el cliente; Shiro anuncia el resultado por voz. Probado end-to-end en Windows. Ver [ADR 0023](docs/adr/0023-shiro-self-improvement-propose-only.md).
12. **Estación holográfica** 🚧 — planificada, sin empezar. Shiro sale de la PC a un objeto físico de escritorio: **lámina semiespejo a 45°** (efecto pepper ghost) dentro de una carcasa impresa en 3D, con cámara, micrófono y altavoz. **Cliente ligero** que se conecta por WS al `core-host` — el cerebro sigue en la PC. Reutiliza el avatar Live2D tal cual (solo un flip vertical del contenedor); el hito VRM 3D le añadirá después **paralaje por head-tracking** sin tocar hardware. Privacidad: presencia, cara y gestos **100% locales**, embeddings faciales y nunca imágenes, frame a la nube solo bajo petición explícita. Resuelve dos diferidos: el **cliente activo** multi-dispositivo de [ADR 0020](docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md) (direccionamiento explícito por modalidad resuelto en un `OutputRouter`; política V1: la respuesta sale por el `clientId` de origen) y el **modelo de confianza de red** — es el trigger que supersede [ADR 0025](docs/adr/0025-modelo-de-confianza-local-y-superficie-de-red.md) por [ADR 0027](docs/adr/0027-autenticacion-token-bus-stt-multicliente.md) (token compartido en el handshake del bus y del STT). Plan por fases, BOM y guía óptica en [`docs/estacion-holografica.md`](docs/estacion-holografica.md). Ver [ADR 0026](docs/adr/0026-estacion-holografica-pepper-ghost-cliente-ligero.md).

Post-MVP: **Modo overlay** (toggle a ventana flotante always-on-top, ADR 0024 §3), **Persistencia de sesiones self-dev en Letta** (ADR 0023, Fase 2), **tool de edición por parche** (hoy self-dev reescribe el archivo entero), **orquestación multi-agente** (planear/ejecutar/revisar con modelos distintos), Plugins, Mobile, Avatar 3D (VRM), Arduino bridge, IoT bridge.

Ver [`README.md`](README.md) y [`docs/architecture.md`](docs/architecture.md)
para el estado vivo.

## Convenciones de Git

### Ramas

- `main` → código estable.
- `develop` → integración (rama por defecto).
- `feat/<nombre>/<tarea>` → trabajo individual.

### Reglas

- **Nadie pushea directo a `main` ni `develop`**. Todo entra por PR.
- PR base = `develop`, no `main`.
- Commits pequeños y frecuentes (~30-60 min de trabajo).

### Prefijos de commit (siempre minúscula + `:`)

| Prefijo  | Uso                                   |
| -------- | ------------------------------------- |
| `feat:`  | nueva funcionalidad                   |
| `fix:`   | corrección de bug                     |
| `test:`  | añadir o mejorar tests                |
| `docs:`  | documentación                         |
| `refac:` | refactor sin cambio de comportamiento |
| `chore:` | mantenimiento (deps, configs)         |
| `ci:`    | cambios al workflow de CI             |

## Antes de pushear

Ejecuta los mismos checks que correrá el CI. Si alguno falla, no pushes — arregla primero:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Calidad de código

- TypeScript **strict**. Sin `any` salvo justificación clara.
- ESM en todos los paquetes (`"type": "module"`).
- Cada módulo del core **implementa una interfaz** en `packages/core/src/interfaces/`.
- Comunicación entre módulos **vía EventBus** — nunca llamadas directas. Ver [ADR 0001](docs/adr/0001-arquitectura-modular-event-driven.md).
- Eventos del bus tipados con generics. Naming: `<modulo>:<verbo>` (p.ej. `stt:transcribed`, `llm:chunk`).
- Tests con **Vitest**. Cobertura objetivo > 80% en `packages/core/`.
- Validación de configs YAML en runtime con **zod**.

## Lo que NO se commitea

- Archivos del **Live2D Cubism SDK Core** (`Live2DCubismCore.js`/`.dll`).
  Son propietarios. Cada dev los descarga manualmente.
- Modelos pesados o propietarios: `.moc3`, `.cmo3`, `.gguf`, `.bin`.
- **API keys**. Todo en `.env` (no trackeado), nunca hardcodeado.
- `node_modules/`, `dist/`, `coverage/` (ya en `.gitignore`).

## Idioma

- **Documentación, comentarios, mensajes de commit, ADRs**: en español.
- **Identificadores de código** (clases, funciones, variables, eventos, archivos): en inglés.

Ejemplo:

```ts
// Procesa una transcripción y dispara el evento llm:responded
class LLMModule {
  async generateResponse(text: string): Promise<string> {
    // ...
  }
}
```

## Si tienes dudas

1. Mira si existe un ADR en `docs/adr/` que cubra el tema.
2. Si no existe y la duda es sobre arquitectura, **pregunta al usuario antes de inventar**.
3. Si descubres que una decisión vieja no tiene ADR pero merecía uno, propón escribir un ADR retrospectivo (Status `Accepted`, fecha real del momento en que se decidió).
