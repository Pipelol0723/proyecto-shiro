# Proyecto Shiro

AI Companion modular con avatar tipo VTuber, voz en tiempo real, memoria
persistente y sistema de módulos intercambiables. Diseñado para crecer:
empieza como asistente desktop, escala a IoT, móvil, Arduino y robots.

> **Estado**: hito **TTS** ✅ completo. Cadena **ElevenLabs primary +
> SystemTTS fallback** in-process en el `core-host` (sin microservicio
> aparte — ElevenLabs es API REST trivial; UTAU/voz sintética se
> reserva para microservicio post-5080). Audio generado server-side y
> servido por HTTP efímero (`GET /audio/<id>.<ext>`, TTL 60s); el
> cliente reproduce con `HTMLAudioElement` y emite `tts:audio-ended`.
> Mapeo emoción → `stability` desde el bloque `emotions:` del character
> YAML. Cancelable mid-speech (`tts:cancel` invalida el cache y para
> el audio). Toggle mute por cliente persistido en `localStorage`
> (preparación para multi-device, lógica de "cliente activo" diferida
> a ADR futuro). (PRs #44-#48.) Hitos previos: **Setup**, **Core**,
> **Cliente desktop**, **LLM**, **Memoria**, **STT**. Próximo hito en
> planificación: **Avatar Live2D**.
> Ver [ADR 0020](docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md).
> Arquitectura viva en [`docs/architecture.md`](docs/architecture.md);
> historial de decisiones en [`docs/adr/`](docs/adr/).

## 🗺️ Roadmap

Las fases originales del [plan inicial](plan-modular-ai-companion.md) usaban
numeración (Fase 0–11). A partir de ADRs 0008-0010 pasamos a **nombres**
porque el cliente desktop se intercaló entre Core y LLM, y los números se
hicieron confusos. La numeración del plan original se conserva en el
histórico.

| Hito                | Estado          | Notas                                                                                                                                                       |
| ------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Setup**           | ✅ completo     | Monorepo, CI, branch protection, ADRs, CLAUDE.md                                                                                                            |
| **Core**            | ✅ completo     | EventBus, Orchestrator, ModuleLoader, 9 interfaces                                                                                                          |
| **Cliente desktop** | ✅ completo     | Vite + React + TS, orbe, 3 temas, 5 pantallas, EventBus wiring                                                                                              |
| **LLM**             | ✅ completo     | `core-host` server Node, WebSocket transport, OllamaLLM, AnthropicLLM, HybridRouter, pipeline conversacional                                                |
| **Memoria**         | ✅ completo     | Letta (SDK oficial + Ollama embeddings) + WAL SQLite con drainer, auto-provisión y `memory:snapshot`. ADRs 0017 y 0018.                                     |
| **STT**             | ✅ completo     | faster-whisper en microservicio Python (Docker + CUDA), captura Web Audio con AudioWorklet, push-to-talk + WS directo cliente↔servicio. ADR 0019.           |
| **TTS**             | ✅ completo     | ElevenLabs primary + SystemTTS fallback, in-process en core-host. Audio HTTP efímero, cliente reproduce. Cancelable mid-speech, mute por cliente. ADR 0020. |
| **Avatar Live2D**   | 🟡 planificando | Reemplaza el orbe dentro del componente `<Avatar>`. Próximo hito.                                                                                           |
| **Packaging Tauri** | ⏸️ pendiente    | Envuelve el build de Vite en binario nativo                                                                                                                 |
| **Post-MVP**        |                 |                                                                                                                                                             |
| Plugins             | ⏳ futuro       | Sistema de extensiones                                                                                                                                      |
| Móvil               | ⏳ futuro       | `@proyecto-shiro/mobile` consumiendo el core via WebSocket                                                                                                  |
| Avatar 3D (VRM)     | ⏳ futuro       | `@pixiv/three-vrm`                                                                                                                                          |
| Arduino bridge      | ⏳ futuro       | `@proyecto-shiro/arduino-bridge` (Serial USB)                                                                                                               |
| IoT bridge          | ⏳ futuro       | MQTT, Home Assistant                                                                                                                                        |

## Stack

- **TypeScript** (ESM, strict) + **Node.js 20+**
- **npm workspaces** para el monorepo
- **Vite + React 18** para `@proyecto-shiro/desktop` (cliente)
- **Tauri 2.0** envolverá el build del cliente en el hito de packaging
- **Ollama + Qwen 2.5** para LLM local
- **Claude Sonnet** vía Anthropic SDK para LLM cloud
- **faster-whisper** (microservicio Python) para STT
- **ElevenLabs** (cloud, primary) + **SystemTTS** (voz del OS, fallback) para TTS (in-process en core-host, audio HTTP efímero)
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

| Variable                      | Default compose | Para qué                                                                                     |
| ----------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `WHISPER_MODEL`               | `small`         | Sube a `large-v3` cuando tengas Tensor Cores (RTX 2060+).                                    |
| `WHISPER_COMPUTE_TYPE`        | `int8`          | Con Tensor Cores cambia a `int8_float16` para ~2× speedup.                                   |
| `WHISPER_PARTIAL_INTERVAL_MS` | `2500`          | Cuánto tarda en emitir partials. Bajar gasta más CPU/GPU; subir te da subtítulos más lentos. |
| `WHISPER_HOTWORDS`            | `Shiro`         | Palabras clave que el decoder boostea (separadas por espacios). Útil para nombres propios.   |

Ver `services/whisper/README.md` para detalles del microservicio.

### Requisitos para el hito TTS (ElevenLabs)

La salida de voz usa **ElevenLabs** como primary y **SystemTTS** (voz del SO via `say.js`) como fallback. Ambos corren in-process en el `core-host` (no hay microservicio aparte — ver [ADR 0020](docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)).

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

El **`stability` por turno** lo lee el TTS del bloque `emotions:` del character YAML (`packages/core/src/character/characters/default.yaml`) en lugar de la config global — eso hace que la voz varíe entre emociones según el personaje.

**Cancelable mid-speech**: si interrumpes a Shiro (apretas el mic durante speaking, o tipeas Enter), el audio actual se corta y arranca el nuevo turno.

**Multi-device**: cada cliente conectado recibe `tts:audio`. Por defecto el primer cliente reproduce y los demás llevan el toggle "audio off". Cada cliente persiste su preferencia en `localStorage`. La lógica de "elegir dispositivo activo" queda para ADR futuro cuando llegue el segundo cliente.

### Requisitos para el hito Avatar Live2D

El avatar visual usa **`pixi-live2d-display`** (wrapper de PixiJS sobre el Cubism SDK oficial) renderizando el modelo dentro del componente `<Avatar>`. Si el SDK o el modelo no están instalados, `<Avatar>` cae al `<Orb>` (ADR 0009) automáticamente — el companion sigue 100% funcional sin avatar visual. Ver [ADR 0021](docs/adr/0021-avatar-live2d-pixi-display-fallback-orbe.md).

**Lo propietario (no entra al repo)**:

1. **Cubism Core SDK Web**: archivo `live2dcubismcore.js`.
   - Bajar el ZIP "Cubism SDK for Web" desde <https://www.live2d.com/sdk/download/web/>.
   - Extraer y copiar `Core/live2dcubismcore.js` a:

     ```
     packages/desktop/public/live2d/Core/live2dcubismcore.js
     ```

2. **Modelo Hiyori** (placeholder hasta tener uno definitivo): viene dentro del mismo ZIP del SDK, en `Samples/TypeScript/Demo/public/Resources/Hiyori/`.
   - Copia la carpeta entera a:

     ```
     packages/desktop/public/live2d/models/Hiyori/
     ```

   - La estructura final dentro de `Hiyori/` debe contener al menos `Hiyori.model3.json`, `Hiyori.moc3`, `expressions/*.exp3.json`, `motions/*.motion3.json`, y las texturas.

**Verificación**: arranca el cliente desktop (`npm run dev -w @proyecto-shiro/desktop`). Si ves a Hiyori en lugar del orbe, todo está cableado. Si sigues viendo el orbe, abre la consola del navegador — verás 404 en `/live2d/Core/live2dcubismcore.js` o `/live2d/models/Hiyori/Hiyori.model3.json` que te dice qué falta.

**Tuneables** (en `config/modules.config.yaml`, slot `avatar.config`):

| Variable          | Default                                    | Para qué                                                                          |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `model_path`      | `/live2d/models/Hiyori/Hiyori.model3.json` | URL del `.model3.json`. Cámbialo cuando bajes el modelo definitivo de Shiro.      |
| `cubism_core_url` | `/live2d/Core/live2dcubismcore.js`         | URL del Cubism Core JS.                                                           |
| `max_fps`         | `30`                                       | Cap del render. 30 para GTX 1650; sube a 60 con la 5080.                          |
| `idle_animation`  | `true`                                     | Animación idle automática del modelo (definida en su `.model3.json`).             |
| `idle_expression` | `idle`                                     | Expresión por defecto. Para Hiyori se traduce a `default` via alias en el código. |

**Disonancia visual del placeholder**: Hiyori es expresiva y cute; Shiro es kuudere y reservada. Esta disonancia es **deuda explícita** hasta que llegue el modelo definitivo. El mapeo provisional `emoción Shiro → expresión Hiyori` vive en `packages/core/src/modules/avatar/hiyori-expression-aliases.ts` y desaparece cuando el modelo definitivo tenga expresiones alineadas con el YAML del personaje (`idle`, `smirk`, `thinking`, `annoyed`, `soft`).

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
Cambiar de proveedor (p.ej. ElevenLabs → SystemTTS) es una sola línea. Ver
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
