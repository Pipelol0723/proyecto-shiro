# Arquitectura de Proyecto Shiro

Documento vivo. Se actualiza cuando cambia algo estructural. Para el
detalle de **por qué** se decidió algo, ver [`adr/`](adr/).

> **Última actualización**: 2026-05-25 (post Fase 0).

## Visión a vista de pájaro

Proyecto Shiro es un AI companion modular que se puede ejecutar como:

- **App desktop autocontenida** (Tauri) — uso típico hoy.
- **Servicio headless** con clientes remotos (móvil, Arduino, IoT) — meta a medio plazo.

Esta dualidad determina la arquitectura: un **cerebro (core)
independiente** y **clientes ligeros** que se conectan.

## Estructura del monorepo

```mermaid
graph TB
    subgraph "proyecto-shiro (monorepo)"
        Root[/"raíz<br>tooling compartido"/]

        subgraph "packages/"
            Core["core<br>cerebro headless<br>@proyecto-shiro/core"]
            Desktop["desktop<br>cliente Tauri<br>@proyecto-shiro/desktop"]
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
            EventBus[EventBus]
            Orchestrator[Orchestrator]
            ModuleLoader[ModuleLoader]
            Logger[Logger]
        end

        subgraph "interfaces/ (contratos)"
            ILLM[ILLMModule]
            ITTS[ITTSModule]
            ISTT[ISTTModule]
            IMem[IMemoryModule]
            IAv[IAvatarModule]
            IRou[IRouterModule]
            IDev[IDeviceModule]
            ITrans[ITransport]
        end

        subgraph "modules/"
            STT[stt/<br>WhisperSTT]
            TTS[tts/<br>ElevenLabs / Kokoro / SystemTTS]
            LLM[llm/<br>Ollama / Anthropic]
            Mem[memory/<br>Letta / LocalMemory]
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
```

**Claves de lectura:**

- Las **interfaces** son contratos. Los módulos los implementan; el
  orchestrator y el resto solo conocen los contratos.
- El **EventBus** no llama directamente a los módulos: emite eventos
  y los receptores se suscriben. Esto rompe el acoplamiento.
- El **ModuleLoader** lee `config/modules.config.yaml`, instancia la
  clase indicada para cada slot y la registra.

## Flujo de una conversación típica

```mermaid
sequenceDiagram
    participant User as Usuario
    participant Mic as Mic (Audio in)
    participant STT
    participant Bus as EventBus
    participant Router as HybridRouter
    participant LLM as Ollama / Claude
    participant Mem as Memory
    participant TTS
    participant Avatar
    participant Speaker as Audio out

    User->>Mic: habla
    Mic->>STT: audio chunk
    STT->>Bus: emit("stt:transcribed", { text })
    Bus->>Router: deliver
    Bus->>Mem: deliver (registra mensaje)

    Router->>LLM: route(text) → local | cloud
    LLM->>Mem: pide contexto reciente
    Mem-->>LLM: contexto
    LLM->>Bus: emit("llm:responded", { text, emotion })

    Bus->>TTS: deliver
    Bus->>Avatar: deliver (mismo evento → expresión)
    Bus->>Mem: deliver (registra respuesta)

    TTS->>Speaker: synth audio
    Avatar->>Speaker: lip sync sincronizado
    Speaker->>User: voz + animación
```

**Notas del flujo:**

- Un mismo evento (`llm:responded`) tiene **varios suscriptores**: el TTS
  lo convierte en audio, el Avatar lo usa para expresión emocional, la
  Memoria lo persiste. Ninguno sabe de los otros — solo ven el bus.
- El `HybridRouter` decide si responde el LLM local (rápido, gratis) o
  el cloud (mejor calidad) según la complejidad estimada del mensaje.
- La memoria se inserta en dos puntos: lee contexto para el LLM, escribe
  cada turno de la conversación.

## Evolución de transportes

Hoy todo corre **in-process** (un solo `node`). Esa es la implementación
trivial del bus.

```mermaid
graph LR
    subgraph "Hoy (Fase 1)"
        Bus1[EventBus] --> IPT1[InProcessTransport]
    end

    subgraph "Mañana (Fase 7 — desktop)"
        Bus2[EventBus] --> IPT2[InProcessTransport]
    end

    subgraph "Cuando llegue móvil (Fase 9)"
        Bus3[EventBus] --> IPT3[InProcessTransport]
        Bus3 --> WS[WebSocketTransport]
        WS -.network.-> Mobile[App móvil]
    end

    subgraph "Cuando llegue Arduino"
        Bus4[EventBus] --> IPT4[InProcessTransport]
        Bus4 --> Ser[SerialTransport]
        Ser -.USB.-> Ard[Arduino]
    end

    subgraph "Cuando llegue IoT (Fase 11)"
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
  controlables (placeholder hoy, se llenará en Fase 11 o antes).

El `ModuleLoader` lee el primero al arrancar. El `DeviceRegistry`
leerá el segundo.

Validación de la forma de los YAML con **zod** (Fase 1).

## Personalidad y personaje

El "carácter" del companion (Shiro) vive en
`packages/core/src/character/characters/default.yaml`. Contiene:

- Identidad (nombre, pronombres, backstory).
- Rasgos de personalidad y estilo de habla.
- Mapeo de **emociones → parámetros TTS y expresiones del avatar**.

El `CharacterLoader` (Fase 2) inyecta esta info como system prompt en
cada conversación con el LLM y propaga los parámetros emocionales al
TTS y al Avatar cuando llega una respuesta.

## Cómo añadir un módulo nuevo (en 5 pasos)

1. Decide qué interfaz implementa (`ILLMModule`, `ITTSModule`, etc.).
   Si no encaja, considera si necesitas una nueva interfaz (escribe un ADR).
2. Crea la clase en `packages/core/src/modules/<categoría>/MiModulo.ts`.
3. Implementa los métodos de la interfaz. Comunica via EventBus.
4. Registra el módulo en `config/modules.config.yaml` (campo `active`
   del slot correspondiente).
5. Añade tests en `packages/core/tests/unit/` y opcionalmente integración.

Tiempo objetivo: menos de 2 horas para un módulo simple.

## Referencias internas

- [`adr/`](adr/) — historial de decisiones arquitectónicas.
- [`plan-modular-ai-companion.md`](../plan-modular-ai-companion.md) —
  visión y plan original.
