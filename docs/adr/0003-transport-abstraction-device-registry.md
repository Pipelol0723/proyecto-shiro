# ADR 0003: Transport abstraction y Device Registry

- **Status**: Accepted
- **Fecha**: 2026-05-25
- **Decidido por**: Pipelol0723

## Contexto

[ADR 0001](0001-arquitectura-modular-event-driven.md) estableció que los
módulos se comunican vía EventBus pub/sub. Implementación natural:
emisor y receptores viven en el mismo proceso Node, comparten memoria.

Pero el alcance del proyecto incluye clientes que **no viven en el mismo
proceso**:

- App móvil: proceso distinto, otro dispositivo, vía red.
- Arduino: microcontrolador, comunicación por Serial USB o WiFi.
- Bridge IoT (Home Assistant, MQTT): otros protocolos.
- Cliente desktop como proceso separado del core, si decidimos correr
  el core como servicio.

Si el `EventBus` solo sabe entregar eventos in-process, **no puede
hablar** con un Arduino o un móvil. Tendríamos que duplicar lógica de
publicación o acoplar el bus a un transporte específico.

Además, controlar dispositivos (luces, sensores, motores de un robot)
requiere un mecanismo de **registro y descubrimiento**: el companion
necesita saber qué dispositivos existen, qué pueden hacer y cuál es
su estado.

Si añadimos esto en Fase 11 (post-MVP), nos toca refactor del EventBus
y de todos los módulos que usan eventos remotos. Mejor diseñar el
contrato bien desde el inicio.

## Decisión

**Dos abstracciones complementarias**, definidas desde Fase 1:

### 1. `IEventBus` + `ITransport` separados

```
EventBus  ─── delega a ─→  Transport (uno o varios)
```

- `IEventBus`: API pub/sub tipada (`emit`, `on`, `off`). Es lo que usan
  los módulos. Su implementación no sabe cómo viaja un evento al otro
  lado, solo cómo recibirlo y entregarlo.

- `ITransport`: define cómo viajan los eventos físicamente.
  Implementaciones previstas:
  - `InProcessTransport` (Fase 1): mismo proceso, sin red.
  - `WebSocketTransport` (cuando llegue móvil / UI remota).
  - `MQTTTransport` (Home Assistant, broker MQTT).
  - `SerialTransport` (Arduino conectado por USB).

El EventBus recibe el transport por inyección. Un EventBus puede tener
**varios transports activos** (in-process + WebSocket simultáneamente,
por ejemplo), y propaga eventos por todos.

### 2. `IDeviceModule` + `DeviceRegistry`

- `IDeviceModule`: representa cualquier dispositivo controlable. Métodos
  como `getStatus()`, `sendCommand(cmd)`, `subscribe(listener)`.
  Implementaciones futuras: `MQTTLight`, `ArduinoMotor`, `HomeAssistantSensor`.

- `DeviceRegistry`: clase central que mantiene el catálogo de dispositivos
  registrados. Métodos: `register(device)`, `unregister(id)`, `list(filter)`,
  `getById(id)`.

El registry se alimenta de `config/devices.config.yaml` al arranque y
puede recibir registros dinámicos vía eventos (descubrimiento).

## Alternativas consideradas

- **EventBus monolítico con if/else por tipo de mensaje**: descartado.
  Acopla el bus a cada transport, no escala.
- **Una librería externa como NATS o RabbitMQ**: descartado por ahora.
  Demasiado pesado para Fase 1 y dificulta correr en local sin extra
  infrastructure. Si el proyecto crece mucho, se puede añadir un
  `NATSTransport` más adelante sin cambiar el resto.
- **No definir `IDeviceModule` hasta Fase 11**: descartado. Si en Fase 1
  no hay contrato, los demás módulos no tienen forma de hablar con
  futuros dispositivos. Mejor el contrato vacío que ningún contrato.
- **Acoplar `DeviceRegistry` directamente al EventBus**: descartado.
  Son conceptos diferentes (un dispositivo no siempre es solo un
  emisor/receptor de eventos; puede tener estado, configuración, etc.).
  Mantenerlos separados permite que el registry use el bus, pero no
  esté obligado a vivir dentro de él.

## Consecuencias

### Positivas

- En Fase 1 implementamos solo `InProcessTransport` — pero el código
  del EventBus no asume que es el único.
- Cuando llegue móvil (Fase 9), implementar `WebSocketTransport` y
  configurarlo es la única adición. Ningún módulo existente cambia.
- Lo mismo para Arduino y MQTT: cada transporte es una clase nueva.
- El device registry está listo para recibir implementaciones cuando
  llegue Fase 11 (o antes si se prioriza Arduino).

### Negativas / Riesgos

- Más interfaces que definir en Fase 1: `IEventBus`, `ITransport`,
  `IDeviceModule`, `DeviceRegistry`. Aumenta la superficie de contrato.
- Riesgo de over-engineering si el proyecto no llega a IoT/móvil.
  Mitigado por la convicción del usuario de que sí llegará.
- Serializar eventos para que viajen por red implica que el formato del
  payload debe ser JSON-friendly. Sin objetos con métodos, instancias
  de clases, etc. Convención: payloads son DTOs planos.

### Neutrales

- El log de eventos será más útil que en el plan original — al
  rastrear transports, vemos no solo qué evento pasó sino por dónde
  viajó.

## Notas de implementación

- `packages/core/src/interfaces/IEventBus.ts`
- `packages/core/src/interfaces/ITransport.ts`
- `packages/core/src/interfaces/IDeviceModule.ts`
- `packages/core/src/core/event-bus.ts` — EventBus que recibe transports.
- `packages/core/src/core/transports/in-process-transport.ts` — única
  implementación de Fase 1.
- `packages/core/src/modules/devices/device-registry.ts` — registry
  vacío inicialmente, lee `devices.config.yaml`.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — la base que
  esto extiende.
- [ADR 0002](0002-monorepo-npm-workspaces.md) — el monorepo es lo que
  hace viable que móvil/Arduino sean paquetes separados consumiendo el
  core via transports.
