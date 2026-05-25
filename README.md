# Proyecto Shiro

AI Companion modular con avatar tipo VTuber, voz en tiempo real, memoria
persistente y sistema de módulos intercambiables. Diseñado para crecer:
empieza como asistente desktop, escala a IoT, móvil, Arduino y robots.

> Estado actual: **Fase 0 — Setup completo**. Monorepo con `@proyecto-shiro/core`
> (cerebro headless) y `@proyecto-shiro/desktop` (cliente Tauri, skeleton).
> Implementación de módulos comienza en Fase 1.

Para la visión completa, fases y arquitectura inicial, ver
[plan-modular-ai-companion.md](plan-modular-ai-companion.md).

## Stack

- **TypeScript** (ESM, strict) + **Node.js 20+**
- **npm workspaces** para el monorepo
- **Tauri** para desktop (Fase 7)
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
│   │   │   ├── interfaces/         ← Contratos: ILLMModule, ITTSModule, etc.
│   │   │   ├── modules/            ← Implementaciones (stt, tts, llm, memory, avatar, router)
│   │   │   ├── plugins/            ← Features futuras (IoT, devices, etc.)
│   │   │   └── character/          ← Loader + definiciones de personaje
│   │   ├── tests/                  ← Unit + integration
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   └── vitest.config.ts
│   │
│   └── desktop/                    ← @proyecto-shiro/desktop (cliente Tauri, Fase 7)
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
│
├── config/                         ← YAML editable (módulos activos, dispositivos)
│   ├── modules.config.yaml
│   └── devices.config.yaml
│
├── docs/                           ← Documentación de arquitectura
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
tooling (TS, ESLint, Prettier, Vitest) desde la raíz.

Futuros paquetes previstos: `@proyecto-shiro/mobile`, `@proyecto-shiro/arduino-bridge`,
`@proyecto-shiro/iot-bridge`.

## Configuración

Los módulos activos se eligen en [config/modules.config.yaml](config/modules.config.yaml).
Cambiar de proveedor (p.ej. ElevenLabs → Kokoro) es una sola línea.

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
script de setup (instrucciones detalladas llegarán en la Fase 6).

### Modelos de avatar

Los archivos `.moc3` / `.model3.json` descargados de Booth.pm u otras
fuentes están sujetos a las licencias de sus respectivos autores. **No
los commitees** salvo que tengas autorización explícita.

### API keys

Toda credencial (ANTHROPIC_API_KEY, ELEVENLABS_API_KEY) va en `.env`,
nunca hardcodeada en el código ni commiteada. Plantilla en `.env.example`.

## Licencia

Por definir. Proyecto personal por ahora.
