# ADR 0001: Arquitectura modular event-driven con interfaces

- **Status**: Accepted
- **Fecha**: 2026-05-25
- **Decidido por**: Pipelol0723

## Contexto

Proyecto Shiro es un AI companion que combina varios subsistemas
heterogéneos: reconocimiento de voz (STT), modelos de lenguaje (LLM
local y cloud), síntesis de voz (TTS), avatar animado, memoria
persistente y un sistema de personalidad.

Cada subsistema tiene **múltiples implementaciones posibles** y queremos
poder cambiarlas:

- **LLM**: Ollama local hoy, Claude API mañana, otro modelo pasado mañana.
- **TTS**: ElevenLabs por calidad, Kokoro como fallback offline, voz del
  SO como último recurso.
- **Memoria**: Letta self-hosted, o LocalMemory simple con SQLite.
- **Avatar**: Live2D 2D hoy, VRM 3D en el futuro.

Además, el alcance del proyecto se ampliará a IoT, móvil, Arduino y
robots simples — eso implica más módulos heterogéneos que necesitan
hablarse entre sí sin acoplarse.

Si codeamos los subsistemas con llamadas directas (`elevenLabs.speak(text)`
desde el orchestrator), cambiar de proveedor implica tocar el orchestrator
cada vez. Eso no escala.

## Decisión

**Arquitectura modular event-driven** con tres pilares:

1. **Cada subsistema implementa una interfaz** (`ILLMModule`, `ITTSModule`,
   `ISTTModule`, etc.). El orchestrator y los demás módulos solo conocen
   las interfaces, no las implementaciones concretas.

2. **La comunicación entre módulos pasa por un EventBus pub/sub**. Ningún
   módulo llama directamente a otro: emite un evento (`stt:transcribed`)
   y quien tenga que reaccionar se suscribe. Esto elimina el acoplamiento.

3. **El módulo activo se elige por config** (`config/modules.config.yaml`).
   Cambiar de proveedor es modificar una línea de YAML, no de código.

## Alternativas consideradas

- **Llamadas directas entre módulos (acoplamiento fuerte)**: descartado.
  Implica refactor cada vez que cambia un proveedor.
- **Inyección de dependencias sin EventBus**: descartado para el flujo
  asíncrono entre módulos. Sí lo usamos para inyectar la implementación
  concreta de una interfaz dentro de un módulo, pero la comunicación
  módulo-a-módulo va por el bus.
- **Framework existente (NestJS, etc.)**: descartado. Añade peso y
  ceremonia. El sistema es lo bastante simple para hacerlo con TS puro.
- **Librería de EventBus tipo `mitt` o `EventEmitter3`**: descartado en
  favor de implementación custom. Razón principal: **aprendizaje**. El
  usuario quiere entender cómo se construye un pub/sub tipado en TS,
  no solo usarlo.

## Consecuencias

### Positivas

- Cambiar de proveedor (Ollama → otro modelo local, ElevenLabs → Kokoro)
  es tocar YAML, no código.
- Cada módulo es testeable de forma aislada con mocks de la interfaz.
- Añadir un módulo nuevo (p.ej. un sensor IoT) consiste en implementar
  la interfaz correspondiente y registrarlo en el YAML.
- El equipo puede trabajar en módulos diferentes en paralelo sin
  pisarse.

### Negativas / Riesgos

- Más boilerplate inicial: hay que definir contratos antes de implementar.
- Debugging es más indirecto: un evento emitido se procesa "en otro sitio".
  Mitigamos con **logger estructurado** que rastree eventos.
- El EventBus custom es código que tenemos que mantener (vs. depender
  de una librería). Aceptado por la razón de aprendizaje.
- Riesgo de "espagueti de eventos" si no hay disciplina en el naming.
  Mitigación: convención `<modulo>:<verbo>` (p.ej. `stt:transcribed`,
  `llm:responded`) y un evento por mensaje claro.

### Neutrales

- El orchestrator pasa a ser un coordinador delgado que solo conecta
  flujos de eventos, no contiene lógica de negocio.
- Los nombres de eventos se convierten en un "API interno" que hay que
  documentar (lo haremos en `docs/architecture.md`).

## Notas de implementación

- Interfaces vivirán en `packages/core/src/interfaces/`.
- EventBus custom en `packages/core/src/core/event-bus.ts` (Fase 1).
- ModuleLoader lee `config/modules.config.yaml`, instancia las clases
  indicadas y las registra en el orchestrator.
- Cada módulo concreto vive en `packages/core/src/modules/<categoría>/`.

## Referencias

- Plan original: `plan-modular-ai-companion.md`
- [ADR 0002](0002-monorepo-npm-workspaces.md) — extiende esto al
  decidir cómo organizamos paquetes.
- [ADR 0003](0003-transport-abstraction-device-registry.md) — extiende
  el EventBus para que pueda hablar con procesos remotos (móvil, Arduino).
