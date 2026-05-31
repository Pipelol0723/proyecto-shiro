# Proyecto Shiro

AI Companion modular con avatar tipo VTuber, voz en tiempo real, memoria
persistente y sistema de módulos intercambiables. Diseñado para crecer:
empieza como asistente desktop, escala a IoT, móvil, Arduino y robots.

> **Estado**: hito **Memoria** ✅ completo. Letta vía SDK oficial con
> embeddings locales en Ollama, `LocalMemory` SQLite como WAL +
> drainer en background, auto-provisión del agente Letta al arrancar,
> y `memory:snapshot` que rehidrata el chat del desktop al reconectar
> (PRs #28-#35). Hitos previos: **Setup**, **Core**, **Cliente
> desktop**, **LLM**. Próximo hito en planificación: **STT**.
> Ver [ADR 0017](docs/adr/0017-memoria-persistente-local-y-letta.md) y
> [ADR 0018](docs/adr/0018-letta-sdk-oficial-embeddings-ollama.md).
> Arquitectura viva en [`docs/architecture.md`](docs/architecture.md);
> historial de decisiones en [`docs/adr/`](docs/adr/).

## 🗺️ Roadmap

Las fases originales del [plan inicial](plan-modular-ai-companion.md) usaban
numeración (Fase 0–11). A partir de ADRs 0008-0010 pasamos a **nombres**
porque el cliente desktop se intercaló entre Core y LLM, y los números se
hicieron confusos. La numeración del plan original se conserva en el
histórico.

| Hito                | Estado          | Notas                                                                                                                   |
| ------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Setup**           | ✅ completo     | Monorepo, CI, branch protection, ADRs, CLAUDE.md                                                                        |
| **Core**            | ✅ completo     | EventBus, Orchestrator, ModuleLoader, 9 interfaces                                                                      |
| **Cliente desktop** | ✅ completo     | Vite + React + TS, orbe, 3 temas, 5 pantallas, EventBus wiring                                                          |
| **LLM**             | ✅ completo     | `core-host` server Node, WebSocket transport, OllamaLLM, AnthropicLLM, HybridRouter, pipeline conversacional            |
| **Memoria**         | ✅ completo     | Letta (SDK oficial + Ollama embeddings) + WAL SQLite con drainer, auto-provisión y `memory:snapshot`. ADRs 0017 y 0018. |
| **STT**             | 🟡 planificando | faster-whisper o similar. Arquitectura por decidir (microservicio Python vs Node bindings, modelo, VAD, streaming).     |
| **TTS**             | ⏸️ pendiente    | ElevenLabs → Kokoro → SystemTTS (cadena de fallbacks)                                                                   |
| **Avatar Live2D**   | ⏸️ pendiente    | Reemplaza el orbe dentro del componente `<Avatar>`                                                                      |
| **Packaging Tauri** | ⏸️ pendiente    | Envuelve el build de Vite en binario nativo                                                                             |
| **Post-MVP**        |                 |                                                                                                                         |
| Plugins             | ⏳ futuro       | Sistema de extensiones                                                                                                  |
| Móvil               | ⏳ futuro       | `@proyecto-shiro/mobile` consumiendo el core via WebSocket                                                              |
| Avatar 3D (VRM)     | ⏳ futuro       | `@pixiv/three-vrm`                                                                                                      |
| Arduino bridge      | ⏳ futuro       | `@proyecto-shiro/arduino-bridge` (Serial USB)                                                                           |
| IoT bridge          | ⏳ futuro       | MQTT, Home Assistant                                                                                                    |

## Stack

- **TypeScript** (ESM, strict) + **Node.js 20+**
- **npm workspaces** para el monorepo
- **Vite + React 18** para `@proyecto-shiro/desktop` (cliente)
- **Tauri 2.0** envolverá el build del cliente en el hito de packaging
- **Ollama + Qwen 2.5** para LLM local
- **Claude Sonnet** vía Anthropic SDK para LLM cloud
- **faster-whisper** (microservicio Python) para STT
- **ElevenLabs** + **Kokoro** para TTS
- **Letta** (Docker) para memoria larga, **LocalMemory** SQLite como fallback
- **Live2D Cubism SDK Web** para avatar 2D
- **Vitest** para tests

## Requisitos

- Node.js >= 20 (probado con 22)
- npm >= 10
- (Más adelante) Docker, Python 3.11+, Ollama

## Setup local

```bash
# Clonar y entrar
git clone https://github.com/Pipelol0723/proyecto-shiro.git
cd proyecto-shiro

# Asegurarse de estar en develop
git checkout develop

# Instalar dependencias (npm instala todos los workspaces)
npm install

# Verificar que todo compila
npm run typecheck

# Ejecutar tests
npm test
```

## Arrancar la app (modo dev)

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
- `SHIRO_HOST_PORT` — puerto del WS (default 9876)
- `VITE_SHIRO_HOST_URL` — URL que usa el cliente (default `ws://localhost:9876/bus`)
- `OLLAMA_HOST` — endpoint de Ollama (default `http://localhost:11434`)
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error`

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

El agente de Letta se **auto-provisiona** la primera vez que el `core-host` arranca con Letta arriba; su id se persiste en el WAL local (`./data/memory.db`). No hay que crearlo a mano ni pegar ids. El agente se crea con un `embedding_config` explícito hacia Ollama (ver `config/modules.config.yaml`, bloque `memory.letta`).

> **Embeddings**: la config apunta a la API OpenAI-compat de Ollama con `embedding_endpoint: http://host.docker.internal:11434/v1`. El sufijo `/v1` es **obligatorio** (sin él, Letta da `404 page not found` al embeber → 500 en cada turno). En Windows/macOS el contenedor llega al host por `host.docker.internal`, no `localhost`. Si cambias de modelo de embeddings, ajusta también `embedding_dim`. Esto funciona también contra un Letta que ya tengas corriendo, sin recrearlo.

> **Recall instantáneo**: Ollama descarga los modelos tras ~5 min de inactividad, así que el primer turno tras una pausa paga un _cold-start_ de varios segundos (el WAL lo cubre — no se pierde nada). Shiro hace un _warm-up_ del embedding al arrancar para que el recall semántico vaya fino desde el primer turno. Para recall siempre instantáneo aunque haya pausas, arranca Ollama con `OLLAMA_KEEP_ALIVE=-1` (mantiene los modelos cargados en memoria).

Si Letta no está corriendo, el companion **funciona igual**: los turnos se guardan en el WAL local (SQLite) y se drenan a Letta en cuanto vuelva. Cero turnos perdidos.

## Scripts disponibles (desde la raíz)

| Comando                 | Descripción                                      |
| ----------------------- | ------------------------------------------------ |
| `npm run build`         | Compila todos los workspaces (`tsc` por paquete) |
| `npm run typecheck`     | Verifica tipos en todos los paquetes             |
| `npm test`              | Ejecuta tests vía Vitest workspace               |
| `npm run test:watch`    | Tests en modo watch                              |
| `npm run test:coverage` | Tests con reporte de cobertura                   |
| `npm run lint`          | Lintea todo el monorepo con ESLint               |
| `npm run lint:fix`      | Lintea y arregla lo automatizable                |
| `npm run format`        | Formatea con Prettier (todos los paquetes)       |
| `npm run format:check`  | Verifica formato sin escribir (lo que usa el CI) |

Para ejecutar un script solo en un paquete:

```bash
npm run typecheck -w @proyecto-shiro/core
npm test -w @proyecto-shiro/core
```

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
├── docs/
│   ├── architecture.md             ← Arquitectura viva (fuente de verdad actual)
│   ├── adr/                        ← Architecture Decision Records (0001…)
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
`@proyecto-shiro/iot-bridge`. Todos consumirán el `core` vía interfaces y se
conectarán al `core-host` por WebSocket (mismo patrón que el cliente desktop).

## Configuración

Los módulos activos se eligen en [config/modules.config.yaml](config/modules.config.yaml).
Cambiar de proveedor (p.ej. ElevenLabs → Kokoro) es una sola línea. Ver
[ADR 0006](docs/adr/0006-config-validation-zod.md) sobre validación con zod.

El personaje se define en
[packages/core/src/character/characters/default.yaml](packages/core/src/character/characters/default.yaml).

## Flujo de trabajo

- `main` → código estable
- `develop` → integración (rama por defecto)
- `feat/<nombre>/<tarea>` → trabajo individual
- Todo entra por **Pull Request** hacia `develop`. Nadie pushea directo.

Convenciones de commit: `feat:`, `fix:`, `test:`, `docs:`, `refac:`, `chore:`, `ci:`.

## Avisos sobre dependencias propietarias

### Live2D Cubism SDK Web

El **Cubism Core** (archivos `Live2DCubismCore.js` / `.dll`) es propietario
y **NO se commitea al repo**. Cada desarrollador debe descargarlo manualmente
desde https://www.live2d.com/sdk/download/web/ y colocarlo donde indique el
script de setup (instrucciones detalladas llegarán en el hito Avatar Live2D).

### Modelos de avatar

Los archivos `.moc3` / `.model3.json` descargados de Booth.pm u otras
fuentes están sujetos a las licencias de sus respectivos autores. **No
los commitees** salvo que tengas autorización explícita.

### API keys

Toda credencial (ANTHROPIC_API_KEY, ELEVENLABS_API_KEY) va en `.env`,
nunca hardcodeada en el código ni commiteada. Plantilla en `.env.example`.

## Licencia

Por definir. Proyecto personal por ahora.
