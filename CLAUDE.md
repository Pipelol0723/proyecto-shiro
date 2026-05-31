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
6. **STT** 🟡 _planificando_ — faster-whisper o similar. La arquitectura concreta (microservicio Python vs bindings Node, modelo, VAD, streaming vs final-only) se decide en un ADR antes de codear.
7. **TTS** ⏸️ pendiente — ElevenLabs + Kokoro + SystemTTS.
8. **Avatar Live2D** ⏸️ pendiente — reemplaza el orbe dentro de `<Avatar>`.
9. **Packaging Tauri** ⏸️ pendiente — envuelve el build de Vite en binario nativo.

Post-MVP: Plugins, Mobile, Avatar 3D (VRM), Arduino bridge, IoT bridge.

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
