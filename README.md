# Proyecto Shiro

AI Companion modular con avatar tipo VTuber, voz en tiempo real, memoria
persistente y sistema de módulos intercambiables. Diseñado para crecer:
empieza como asistente desktop, escala a IoT, móvil, Arduino y robots.

> **Estado**: fases **Setup** y **Core** completas (53 tests, CI verde).
> Próximo hito: **Cliente desktop** (Vite + React + TS) con orbe placeholder
> del avatar — empieza ahora, no en Fase 7 como decía el plan original.
> Ver [`docs/architecture.md`](docs/architecture.md) para arquitectura
> viva y [`docs/adr/`](docs/adr/) para el historial de decisiones.

## 🗺️ Roadmap

Las fases originales del [plan inicial](plan-modular-ai-companion.md) usaban
numeración (Fase 0–11). A partir de ADRs 0008-0010 pasamos a **nombres**
porque el cliente desktop se intercaló entre Core y LLM, y los números se
hicieron confusos. La numeración del plan original se conserva en el
histórico.

| Hito                | Estado          | Notas                                                                 |
| ------------------- | --------------- | --------------------------------------------------------------------- |
| **Setup**           | ✅ completo     | Monorepo, CI, branch protection, ADRs, CLAUDE.md                      |
| **Core**            | ✅ completo     | EventBus, Orchestrator, ModuleLoader, 9 interfaces, 53 tests          |
| **Cliente desktop** | 🟡 **en curso** | Vite + React + TS, orbe placeholder, 3 temas (kawaii/cyber/editorial) |
| **LLM**             | ⏸️ pendiente    | Ollama (Qwen 2.5) + Anthropic SDK + HybridRouter                      |
| **Memoria**         | ⏸️ pendiente    | Letta self-hosted + LocalMemory SQLite (fallback)                     |
| **STT**             | ⏸️ pendiente    | faster-whisper microservicio Python (puerto 8765)                     |
| **TTS**             | ⏸️ pendiente    | ElevenLabs → Kokoro → SystemTTS (cadena de fallbacks)                 |
| **Avatar Live2D**   | ⏸️ pendiente    | Reemplaza el orbe dentro del componente `<Avatar>`                    |
| **Packaging Tauri** | ⏸️ pendiente    | Envuelve el build de Vite en binario nativo                           |
| **Post-MVP**        |                 |                                                                       |
| Plugins             | ⏳ futuro       | Sistema de extensiones                                                |
| Móvil               | ⏳ futuro       | `@proyecto-shiro/mobile` consumiendo el core via WebSocket            |
| Avatar 3D (VRM)     | ⏳ futuro       | `@pixiv/three-vrm`                                                    |
| Arduino bridge      | ⏳ futuro       | `@proyecto-shiro/arduino-bridge` (Serial USB)                         |
| IoT bridge          | ⏳ futuro       | MQTT, Home Assistant                                                  |

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
│   ├── core/                       ← @proyecto-shiro/core (cerebro headless)
│   │   ├── src/
│   │   │   ├── core/               ← EventBus, Orchestrator, ModuleLoader, Logger
│   │   │   ├── config/             ← Schemas zod + ConfigLoader
│   │   │   ├── interfaces/         ← Contratos: ILLMModule, ITTSModule, etc.
│   │   │   ├── modules/            ← Implementaciones (stt, tts, llm, memory, avatar, router)
│   │   │   ├── plugins/            ← Features futuras (IoT, devices, etc.)
│   │   │   ├── character/          ← Definiciones de personaje YAML
│   │   │   └── types/              ← Emotion, EventMap
│   │   ├── tests/                  ← Unit + integration (53 tests)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   └── vitest.config.ts
│   │
│   └── desktop/                    ← @proyecto-shiro/desktop (cliente Vite+React, en construcción)
│       ├── src/                    ← React app: orbe + 5 pantallas + 3 temas
│       ├── package.json
│       └── tsconfig.json
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
`@proyecto-shiro/iot-bridge`.

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
