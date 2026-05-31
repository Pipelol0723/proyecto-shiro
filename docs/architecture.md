# Arquitectura de Proyecto Shiro

Documento vivo. Se actualiza cuando cambia algo estructural. Para el
detalle de **por qué** se decidió algo, ver [`adr/`](adr/).

> **Última actualización**: 2026-05-31 — tras mergear los hitos **Setup**,
> **Core**, **Cliente desktop** y **LLM**, y completar la mayor parte del
> hito **Memoria** (Letta vía SDK oficial + WAL local con drainer, ADRs
> 0017 y 0018; falta la hidratación del cliente al reconectar).

## Visión a vista de pájaro

Proyecto Shiro es un AI companion modular que se ejecuta como:

- **App desktop** — uso típico hoy. Cliente Vite+React empaquetado con
  Tauri en el hito Packaging.
- **Servicio headless** con clientes remotos (móvil, Arduino, IoT) — meta
  a medio plazo. El cerebro (core) corre como proceso/servicio
  independiente; cualquier cliente se conecta vía Transport.

Esta dualidad determina la arquitectura: un **cerebro (core)
independiente** y **clientes ligeros** que se conectan.

## Estructura del monorepo

```mermaid
graph TB
    subgraph "proyecto-shiro (monorepo)"
        Root[/"raíz<br>tooling compartido"/]

        subgraph "packages/"
            Core["core<br>cerebro headless<br>@proyecto-shiro/core<br>✅ Setup + Core + LLM + Memoria"]
            Desktop["desktop<br>cliente Vite+React<br>@proyecto-shiro/desktop<br>✅ orbe + 5 pantallas + 3 temas"]
            Mobile["mobile<br>cliente futuro<br>@proyecto-shiro/mobile"]
            Arduino["arduino-bridge<br>puente Serial<br>@proyecto-shiro/arduino-bridge"]
            IoT["iot-bridge<br>MQTT/Home Assistant<br>@proyecto-shiro/iot-bridge"]
        end

        Root --> Core
        Root --> Desktop
        Root -.-> Mobile
        Root -.-> Arduino
        Root -.-> IoT

        Desktop --> Core
        Mobile -.-> Core
        Arduino -.-> Core
        IoT -.-> Core
    end

    style Core fill:#4a9eff,stroke:#333,color:#fff
    style Desktop fill:#f4b400,stroke:#333,color:#fff
    style Mobile stroke-dasharray: 5 5
    style Arduino stroke-dasharray: 5 5
    style IoT stroke-dasharray: 5 5
```

Las líneas punteadas son paquetes futuros. Los flujos van **del cliente
al core** (los clientes consumen el cerebro vía interfaces y eventos).

## Composición del core

```mermaid
graph LR
    subgraph "packages/core/src/"
        subgraph "core/"
            EventBus[EventBus<br>✅]
            Orchestrator[Orchestrator<br>✅]
            ModuleLoader[ModuleLoader<br>✅]
            Logger[Logger<br>✅]
            Transports[transports/<br>InProcessTransport ✅]
        end

        subgraph "config/"
            Schemas[schemas.ts<br>zod ✅]
            ConfigLoader[ConfigLoader<br>✅]
        end

        subgraph "interfaces/ (contratos ✅)"
            ILLM[ILLMModule]
            ITTS[ITTSModule]
            ISTT[ISTTModule]
            IMem[IMemoryModule]
            IAv[IAvatarModule]
            IRou[IRouterModule]
            IDev[IDeviceModule]
            ITrans[ITransport]
            IBus[IEventBus]
        end

        subgraph "modules/ (pendientes)"
            STT[stt/<br>WhisperSTT]
            TTS[tts/<br>ElevenLabs / Kokoro / SystemTTS]
            LLM[llm/<br>Ollama / Anthropic]
            Mem[memory/<br>MemoryManager → Letta SDK + LocalMemory WAL]
            Av[avatar/<br>Live2D / VRM]
            Rou[router/<br>HybridRouter]
        end

        Character[character/<br>Loader + personalidad]
        Plugins[plugins/<br>extensiones futuras]
    end

    ModuleLoader --> ILLM
    ModuleLoader --> ITTS
    ModuleLoader --> ISTT
    ModuleLoader --> IMem
    ModuleLoader --> IAv
    ModuleLoader --> IRou

    ConfigLoader --> Schemas
    ModuleLoader --> ConfigLoader

    ILLM -.implementa.-> LLM
    ITTS -.implementa.-> TTS
    ISTT -.implementa.-> STT
    IMem -.implementa.-> Mem
    IAv -.implementa.-> Av
    IRou -.implementa.-> Rou

    Orchestrator --> EventBus
    EventBus --> ITrans

    style EventBus fill:#4a9eff,stroke:#333,color:#fff
    style Orchestrator fill:#4a9eff,stroke:#333,color:#fff
    style ModuleLoader fill:#4a9eff,stroke:#333,color:#fff
```

**Claves de lectura:**

- Las **interfaces** son contratos. Los módulos los implementan; el
  orchestrator y el resto solo conocen los contratos.
- El **EventBus** no llama directamente a los módulos: emite eventos
  y los receptores se suscriben. Esto rompe el acoplamiento. Ver
  [ADR 0001](adr/0001-arquitectura-modular-event-driven.md).
- El **ModuleLoader** lee `config/modules.config.yaml`, valida con zod,
  instancia la clase indicada para cada slot y la registra. Ver
  [ADR 0006](adr/0006-config-validation-zod.md) y
  [ADR 0007](adr/0007-module-loader-registry.md).
- El **Orchestrator** ata todo en el arranque, emite `bus:ready` y
  ofrece un punto de entrada limpio para los clientes.

## Composición del cliente desktop

`@proyecto-shiro/desktop` (Vite + React 18 + TS strict) consume el core
como dependencia local del workspace. Estructura prevista (ADRs 0008,
0009, 0010):

```
packages/desktop/src/
├── main.tsx                     ← Entry: instancia Logger, EventBus, Orchestrator
├── bus-context.tsx              ← BusProvider + useBus() + useBusEvent()
├── state/
│   └── companion-reducer.ts     ← Reducer alimentado por eventos del bus
├── components/
│   ├── Orb/                     ← Placeholder visual del avatar
│   │   ├── Orb.tsx
│   │   ├── Orb.module.css
│   │   └── useOrbAmplitude.ts
│   ├── Avatar/                  ← Decide Orb vs Live2D (cuando llegue)
│   ├── Sidebar/
│   ├── Header/
│   └── ChatPanel/
├── screens/
│   ├── ConversationScreen.tsx
│   ├── ModulesScreen.tsx        ← UI sobre modules.config.yaml
│   ├── CharacterScreen.tsx
│   ├── AvatarScreen.tsx
│   ├── SetupScreen.tsx
│   └── OnboardingScreen.tsx
├── themes/
│   ├── kawaii.css
│   ├── cyber.css
│   └── editorial.css
└── tweaks/                      ← Panel de configuración runtime
```

**Tres temas swap-eables** (kawaii pastel / cyberpunk / editorial)
definidos por CSS vars; el usuario los cambia desde settings sin
recompilar. Ver el bundle de diseño en
[`docs/design-mockup/`](design-mockup/).

### Mapeo state ↔ EventBus

El reducer del cliente se alimenta de eventos del core, y dispara
acciones cuando el usuario actúa:

| Acción del reducer | Origen                               | Evento del EventBus    |
| ------------------ | ------------------------------------ | ---------------------- |
| `LISTEN_START`     | `bus.on('stt:listening')` (futuro)   | `stt:listening`        |
| `STT_PARTIAL`      | `bus.on('stt:partial')`              | `stt:partial`          |
| `STT_FINAL`        | `bus.on('stt:transcribed')`          | `stt:transcribed`      |
| `THINK_START`      | `bus.on('router:routed')`            | `router:routed`        |
| `SHIRO_REPLY`      | `bus.on('llm:responded')`            | `llm:responded`        |
| `SPEAK_END`        | `bus.on('tts:audio-ended')`          | `tts:audio-ended`      |
| (usuario escribe)  | `bus.emit('user:message', { text })` | `user:message` (nuevo) |

Convenios documentados en
[ADR 0010](adr/0010-wiring-cliente-core-eventbus.md).

## Flujo de una conversación típica

```mermaid
sequenceDiagram
    participant User as Usuario
    participant Client as Cliente desktop<br>(React + EventBus)
    participant Mic as Micro / Audio in
    participant STT
    participant Bus as EventBus
    participant Router as HybridRouter
    participant LLM as Ollama / Claude
    participant Mem as Memory
    participant TTS
    participant Avatar as Orbe / Live2D
    participant Speaker as Audio out

    alt Usuario escribe
        User->>Client: tipea + Enter
        Client->>Bus: emit("user:message", { text })
    else Usuario habla
        User->>Mic: habla
        Mic->>STT: audio chunk
        STT->>Bus: emit("stt:transcribed", { text, isFinal: true })
        Bus->>Client: deliver (UI actualiza subtítulos)
        STT->>Bus: emit("user:message", { text })
    end

    Bus->>Router: deliver
    Bus->>Mem: deliver (registra mensaje user)

    Router->>LLM: route() → local | cloud
    LLM->>Mem: pide contexto reciente
    Mem-->>LLM: contexto
    LLM->>Bus: emit("llm:responded", { text, emotion })

    Bus->>Client: deliver (orbe cambia color, subtítulos)
    Bus->>TTS: deliver
    Bus->>Avatar: deliver (mismo evento → expresión)
    Bus->>Mem: deliver (registra respuesta assistant)

    TTS->>Speaker: synth audio
    Avatar->>Speaker: lip sync sincronizado
    Speaker->>User: voz + animación
```

**Notas del flujo:**

- El **cliente es el origen** del evento `user:message` (tanto si el
  input es texto como si es voz transcrita).
- Un mismo evento (`llm:responded`) tiene **varios suscriptores**: el
  cliente actualiza UI, el TTS lo convierte en audio, el Avatar/Orbe
  lo usa para expresión emocional, la Memoria lo persiste. Ninguno
  sabe de los otros — solo ven el bus.
- El `HybridRouter` decide si responde el LLM local (rápido, gratis) o
  el cloud (mejor calidad) según la complejidad estimada del mensaje.
- La memoria se inserta en dos puntos: lee contexto para el LLM, escribe
  cada turno de la conversación.

## Memoria: Letta canónico + WAL local

La memoria (ver [ADR 0017](adr/0017-memoria-persistente-local-y-letta.md) y
[ADR 0018](adr/0018-letta-sdk-oficial-embeddings-ollama.md)) la implementa el
`MemoryManager`, que cumple `IMemoryModule` y orquesta dos backends:

```mermaid
graph LR
    Pipe[conversation-flow] -->|save / getRecent / searchSemantic| MM[MemoryManager]
    MM -->|1 . save síncrono sub-ms| WAL[(LocalMemory<br/>SQLite WAL)]
    MM -->|2 . push inmediato + reads| Letta[LettaMemory<br/>SDK oficial]
    Letta -->|HTTP| Server[(Letta server<br/>Docker)]
    Server -->|embeddings| Ollama[Ollama<br/>mxbai-embed-large]
    WAL -.entradas pendientes.-> Drainer[drainer<br/>setInterval]
    Drainer -->|reintenta en orden| Letta
```

- **Escritura**: cada turno se persiste **primero** en el WAL local (SQLite,
  síncrono) y **luego** se empuja a Letta. Si Letta está caído, la entrada
  queda pendiente y el **drainer** la reenvía cuando vuelve. Cero turnos
  perdidos aunque Letta tartamudee.
- **Lectura** (`getRecent` cronológico + `searchSemantic` semántico): van a
  Letta, que es la verdad. Si Letta no está usable, devuelven `[]` rápido y
  el turno procede sin contexto (Shiro responde "ciego" ese turno).
- **Letta** se usa como _archival store_ semántico (no invocamos su flujo de
  agente; el LLM es nuestro). Los embeddings son **locales vía Ollama**.
- **Auto-provisión**: si no hay `agent_id` configurado, el manager crea el
  agente Letta al arrancar (con los handles de Ollama) y persiste su id en el
  WAL local para sobrevivir reinicios.

## Evolución de transportes

Hoy el cliente desktop comparte el mismo proceso Node del core, así
que un único `InProcessTransport` cubre el caso. Conforme lleguen
clientes en otros procesos/dispositivos, se añaden transports nuevos
**sin tocar los módulos existentes**.

```mermaid
graph LR
    subgraph "Hoy"
        Bus1[EventBus] --> IPT1[InProcessTransport]
    end

    subgraph "Cliente desktop en proceso aparte"
        Bus2[EventBus] --> IPT2[InProcessTransport]
        Bus2 --> WSDesk[WebSocketTransport]
        WSDesk -.localhost.-> ClientDesk[Cliente Tauri]
    end

    subgraph "Cuando llegue móvil"
        Bus3[EventBus] --> IPT3[InProcessTransport]
        Bus3 --> WSMob[WebSocketTransport]
        WSMob -.network.-> Mobile[App móvil]
    end

    subgraph "Cuando llegue Arduino"
        Bus4[EventBus] --> IPT4[InProcessTransport]
        Bus4 --> Ser[SerialTransport]
        Ser -.USB.-> Ard[Arduino]
    end

    subgraph "Cuando llegue IoT"
        Bus5[EventBus] --> IPT5[InProcessTransport]
        Bus5 --> MQTT[MQTTTransport]
        MQTT -.broker.-> HA[Home Assistant]
    end
```

**Importante:** los módulos existentes (LLM, TTS, etc.) **no cambian**
cuando se añade un transporte nuevo. Solo se inyecta el transport
adicional al EventBus en el arranque. Ver
[ADR 0003](adr/0003-transport-abstraction-device-registry.md).

## Configuración

Dos archivos YAML en `config/`:

- **`modules.config.yaml`**: qué implementación se usa en cada slot
  (LLM, TTS, STT, Memory, Avatar, Router). Cadenas de fallback.
- **`devices.config.yaml`**: catálogo de dispositivos IoT/Arduino
  controlables (placeholder hoy, se llenará junto con los bridges).

El `ModuleLoader` (ya implementado) lee el primero al arrancar y
valida con **zod**. El `DeviceRegistry` (interfaz definida, sin impl
todavía) leerá el segundo.

Ver [ADR 0006](adr/0006-config-validation-zod.md).

## Personalidad y personaje

El "carácter" del companion (Shiro) vive en
`packages/core/src/character/characters/default.yaml`. Contiene:

- Identidad (nombre, pronombres, backstory).
- Rasgos de personalidad y estilo de habla.
- Mapeo de **emociones → parámetros TTS y expresiones del avatar**.

El `CharacterLoader` (que se implementará junto al primer LLM real)
inyectará esta info como system prompt en cada conversación y
propagará los parámetros emocionales al TTS y al Orbe/Avatar cuando
llegue una respuesta.

El **orbe placeholder** consume el campo `emotion` del payload de
`llm:responded` y mapea cada emoción a un gradiente de color via
CSS vars del tema activo. Ver
[ADR 0009](adr/0009-orbe-placeholder-avatar.md).

## Cómo añadir un módulo nuevo (en 5 pasos)

1. Decide qué interfaz implementa (`ILLMModule`, `ITTSModule`, etc.).
   Si no encaja, considera si necesitas una nueva interfaz (escribe un ADR).
2. Crea la clase en `packages/core/src/modules/<categoría>/MiModulo.ts`.
3. Implementa los métodos de la interfaz. Comunica vía EventBus.
4. Registra el módulo en `config/modules.config.yaml` (campo `active`
   del slot correspondiente) y en `ModuleLoader` (registry).
5. Añade tests en `packages/core/tests/unit/` y opcionalmente
   integración en `packages/core/tests/integration/`.

Tiempo objetivo: menos de 2 horas para un módulo simple.

## Cómo añadir una pantalla nueva al cliente

1. Crea `packages/desktop/src/screens/MiScreen.tsx`.
2. Suscríbete a eventos del bus con `useBusEvent` y/o lee state del
   reducer con `useCompanionState`.
3. Si necesitas state UI local, usa `useState` en el propio componente.
4. Añade entrada en el sidebar (`packages/desktop/src/components/Sidebar`).
5. Tests con Vitest + React Testing Library en
   `packages/desktop/tests/`.

## Referencias internas

- [`adr/`](adr/) — historial completo de decisiones arquitectónicas.
- [`design-mockup/`](design-mockup/) — bundle del prototipo de Claude
  Design (referencia visual, no código de producción).
- [`../plan-modular-ai-companion.md`](../plan-modular-ai-companion.md) —
  visión y plan original (histórico — conserva la numeración antigua
  de fases).
