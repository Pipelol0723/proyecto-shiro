# Proyecto Shiro

AI Companion modular con avatar tipo VTuber, voz en tiempo real, memoria
persistente y sistema de módulos intercambiables. Cada pieza puede
reemplazarse sin romper el resto.

> Estado actual: **Fase 0 — Setup**. Arquitectura definida, infraestructura
> base lista. Implementación de módulos comienza en Fase 1.

Para visión completa, fases y arquitectura, ver
[plan-modular-ai-companion.md](plan-modular-ai-companion.md).

## Stack

- **TypeScript** (ESM, strict) + **Node.js 20+**
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

# Cambiar a la rama develop
git checkout develop

# Instalar dependencias
npm install

# Verificar que todo compila
npm run typecheck

# Ejecutar tests
npm test
```

## Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run build` | Compila TypeScript a `dist/` |
| `npm run typecheck` | Verifica tipos sin emitir archivos |
| `npm test` | Ejecuta tests con Vitest |
| `npm run test:watch` | Tests en modo watch |
| `npm run test:coverage` | Tests con reporte de cobertura |
| `npm run lint` | Lintea con ESLint |
| `npm run lint:fix` | Lintea y arregla lo automatizable |
| `npm run format` | Formatea con Prettier |
| `npm run format:check` | Verifica formato sin escribir |

## Estructura del proyecto

```
src/
├── core/          ← EventBus, Orchestrator, ModuleLoader, Logger
├── interfaces/    ← Contratos: ILLMModule, ITTSModule, etc.
├── modules/       ← Implementaciones (stt, tts, llm, memory, avatar, router)
├── plugins/       ← Features futuras (IoT, móvil, etc.)
├── character/     ← Loader + definiciones de personaje
└── app/desktop/   ← Entry point Tauri

config/            ← YAML editable (módulos activos, dispositivos)
tests/             ← Unit + integration
docs/              ← Documentación de arquitectura
```

## Configuración

Los módulos activos se eligen en [config/modules.config.yaml](config/modules.config.yaml).
Cambiar de proveedor (p.ej. ElevenLabs → Kokoro) es una sola línea.

El personaje se define en [src/character/characters/default.yaml](src/character/characters/default.yaml).

## Flujo de trabajo

- `main` → código estable
- `develop` → integración
- `feat/<nombre>/<tarea>` → trabajo individual
- Todo entra por **Pull Request** hacia `develop`. Nadie pushea directo.

Convenciones de commit: `feat:`, `fix:`, `test:`, `docs:`, `refac:`, `chore:`.

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
nunca hardcodeada en el código ni commiteada.

## Licencia

Por definir. Proyecto personal por ahora.
