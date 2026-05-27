# ADR 0013: Protocolo WebSocket para el EventBus

- **Status**: Accepted
- **Fecha**: 2026-05-27
- **Decidido por**: Pipelol0723

## Contexto

[ADR 0012](0012-split-cliente-server-core-host.md) decidió mover el core a un proceso Node aparte (`@proyecto-shiro/core-host`) y conectar el cliente desktop via WebSocket. Necesitamos definir **el formato exacto de los mensajes que viajan por ese cable**.

Esta decisión es la **más importante para el futuro del proyecto** entre todas las del hito LLM, porque:

- **Móvil futuro** (`@proyecto-shiro/mobile`) consumirá el mismo protocolo.
- **Arduino bridge** y **IoT bridge** son candidatos al mismo formato (vía adapter, no necesariamente WebSocket — pero la forma del payload viaja).
- Una vez publicado, romperlo implica versionar y dar soporte a múltiples clientes a la vez.

Las decisiones se hacen ahora porque el `WebSocketTransport` (PR 2) lo necesita concreto.

### Lo que ya está resuelto sin que el protocolo lo diga

El `EventBus` (ver `packages/core/src/core/event-bus.ts`) tiene una invariante crítica:

```typescript
// Cuando un transport entrega un evento entrante, el bus lo despacha
// SOLO a handlers locales — NO lo re-envía a otros transports.
private bindTransport(transport: ITransport): void {
  transport.onReceive(async (event, payload) => {
    // bus.dispatchLocal solamente, no re-emit
  });
}
```

Esto significa que **el protocolo no necesita preocuparse de loops**. Si cliente emite `user:message`, server lo recibe via transport y lo despacha local. Server-side modules responden con `llm:responded`, server emite → transport envía a cliente → cliente despacha local. Cero riesgo de echo infinito.

## Decisión

**Protocolo V1: JSON sobre WebSocket, un único tipo de mensaje (`event`), broadcast-everything sin suscripciones explícitas.**

### Envelope

```typescript
interface WireEnvelope {
  /** Versión del protocolo. Incrementar al hacer cambios incompatibles. */
  v: 1;

  /** Tipo de mensaje. V1 solo soporta 'event'. Reservado para extensión. */
  kind: 'event';

  /** Nombre del evento — debe ser una clave válida del EventMap. */
  name: string;

  /** Payload del evento, JSON-serializable. */
  payload: unknown;

  /** ISO 8601. Útil para diagnóstico y latency tracking. */
  ts: string;
}
```

Ejemplo concreto en el cable:

```json
{
  "v": 1,
  "kind": "event",
  "name": "user:message",
  "payload": { "text": "hola", "userId": "default" },
  "ts": "2026-05-27T16:42:01.123Z"
}
```

### Validación

Cada lado valida el envelope con un schema **zod** al recibir. Si falla la validación:

- Log a `error` con el mensaje crudo (truncado).
- **No** cerrar la conexión — un mensaje malformado no debería tirar al cliente.
- Mensaje ignorado, no entra al bus.

El payload **no se valida** en el transport — eso es responsabilidad del handler que lo consume (si quiere). Razón: el `EventMap` ya es la fuente de verdad de tipos, y validar cada payload aquí duplicaría schemas que no existen todavía (cada evento del EventMap es un type literal, no un schema zod).

Cuando un evento concreto necesite validación estricta (por ej. `user:message` cuando llegue input no confiable de móvil), se añade un schema en el handler del lado receptor.

### Modelo: broadcast-everything

**No hay subscripciones explícitas.** Cada lado emite todos sus eventos al transport; el receptor los despacha en su bus local. Si no hay handlers para un evento, se descarta como no-op (el `dispatchLocal` ya es O(1) para "no handlers").

Esto es válido porque:

- El conjunto de eventos en `EventMap` es chico y predecible.
- El cliente naturalmente solo tiene handlers para eventos UI-relevantes (`llm:responded`, `bus:ready`, etc.).
- El server naturalmente solo tiene handlers para eventos input (`user:message`).
- Tráfico extra es despreciable en localhost.

Cuando llegue móvil con red real, evaluamos. La extensión natural sería `kind: 'subscribe'` añadido como mensaje, sin romper compatibilidad con V1.

### Reconexión

Cliente implementa **reconexión automática con backoff exponencial**:

| Intento | Espera      |
| ------- | ----------- |
| 1       | 250 ms      |
| 2       | 500 ms      |
| 3       | 1 s         |
| 4       | 2 s         |
| 5+      | 5 s (techo) |

Sin límite de reintentos — la app desktop es de uso continuo. Si el server cae, cuando vuelva el cliente reconecta solo.

Al reconectar:

- Cliente **no re-envía** mensajes encolados durante la desconexión. Si se perdió un `user:message` en flight, el usuario lo verá (no llegó respuesta) y reintentará manualmente.
- Server **no replay**ea eventos perdidos. La conversación vive en memoria del server; al reconectar el cliente, el siguiente `user:message` arranca desde donde esté el server.
- Cliente puede pintar un estado "reconectando" en la UI mientras dura el backoff.

### Sin ack, sin reintentos a nivel app

V1 confía en TCP/WebSocket:

- TCP garantiza orden y entrega mientras la conexión está viva.
- WebSocket detecta caída → cliente se entera → reconecta.
- Si un mensaje sale mientras la conexión está caída, se pierde. No hay queue local.

Esto es suficiente para chat — la peor consecuencia de perder un evento es un reintento manual del usuario. No vale la pena complicar el protocolo con confirmaciones por nivel app.

### Versionado

El campo `v: 1` permite:

- Bumpar a `v: 2` cuando se rompa compatibilidad (cambio de campos, semántica nueva).
- Cliente y server pueden negociar versión en el primer mensaje futuro (`v: 2` añadiría `kind: 'hello'`). V1 asume que ambos lados hablan V1.

Cuando se requiera, el `kind: 'event'` literal se extenderá a una union (`'event' | 'subscribe' | 'hello' | ...`).

### Topología

V1: **un único cliente conectado a la vez por server**. Si llegan dos, ambos reciben todos los eventos del server (broadcast simple). Sin sesiones, sin per-client state.

Esto bastará hasta que llegue móvil. Cuando haya múltiples clientes (desktop + móvil simultáneos al mismo server), evaluar:

- Sesiones identificadas por `userId`.
- Per-client filtering (server elige a quién enviar cada evento).
- Conversaciones aisladas vs compartidas.

V1 no decide nada de esto — sale del scope.

## Alternativas consideradas

- **MessagePack en lugar de JSON**: descartado. Menos legible al debuggear DevTools, ahorro de bytes irrelevante en localhost. Cuando llegue red móvil con ancho de banda apretado, posible revisita.
- **gRPC / Protobuf**: descartado. Pesado para nuestro caso, requiere `.proto` files y codegen. JSON encaja con el ecosistema TS/JS.
- **Suscripciones explícitas desde V1** (`kind: 'subscribe', name: 'llm:chunk'`): descartado. Añade complejidad sin ganancia inmediata. El cliente, naturalmente, solo despacha lo que tiene handlers. El extra tráfico es <1 KB/turn en localhost.
- **Acks de aplicación (`kind: 'ack', refId: '...'`)**: descartado. TCP/WS ya garantiza entrega mientras la conexión está viva. Para chat humano no compensa la complejidad.
- **Replay de eventos perdidos al reconectar**: descartado para V1. Requiere que el server bufferee últimos N eventos por cliente, y que cliente envíe "último ID recibido". Útil cuando haya móvil con red flaky — añadir como `kind: 'resume'` en V2.
- **Sin envelope, payload directo** (`{ event, payload }` sin `v`/`kind`/`ts`): descartado. La falta del `v` impediría versionar más adelante sin romper. El coste de tener tres campos extra es despreciable.
- **WebSocket sin TLS en localhost (ws://) vs wss://**: V1 usa `ws://localhost:PORT`. TLS lo añadimos cuando el server salga de localhost (móvil remoto, despliegue real).

## Consecuencias

### Positivas

- **Formato mínimo y autoexplicativo.** Cualquier dev nuevo entiende el envelope en 30 segundos viendo DevTools.
- **Extensible sin romper.** El `v: 1` y `kind: 'event'` reservan espacio para versiones futuras.
- **El bus existente no cambia.** El `WebSocketTransport` solo serializa/deserializa el envelope; el resto del flujo es igual que con `InProcessTransport`.
- **Cero loops por construcción.** El `EventBus` ya garantiza la no-recursión.
- **Debugging fácil.** JSON legible en cualquier inspector de red.

### Negativas / Riesgos

- **Tráfico extra sin suscripciones.** Cada evento server-side se envía al cliente aunque éste no tenga handler. Asumible en localhost; revisita cuando haya móvil o múltiples clientes.
- **Sin garantía de entrega durante desconexión.** Mensajes en flight se pierden si la conexión cae. Aceptado — el usuario lo notará y reintentará.
- **`payload: unknown` cruza la barrera de tipos.** El sistema TS no sabe que `user:message` payload tiene `{text, userId}` después de deserializar. Los handlers que reciban el payload del transport deberán cast o validar. Mitigación: el `EventMap` sigue siendo la fuente de verdad y los handlers son tipados (`bus.on('user:message', (p) => ...)` recibe `p` tipado).
- **El cliente ve eventos internos del server.** Si el server emite `module:loaded` (no existe hoy, pero es un futuro plausible), el cliente lo recibirá y lo ignorará. No daña pero crece el tráfico.
- **Sin auth en V1.** Cualquiera con acceso a `ws://localhost:PORT` puede conectarse. Aceptable porque es localhost; cuando salga a red, añadir token compartido en query string o header.

### Neutrales

- **No hay heartbeat / keepalive explícito.** WebSocket nativo ya incluye ping/pong para detectar conexiones muertas. Confiamos en eso.
- **Puerto por defecto: `9876`.** Elegido arbitrariamente — fuera del rango común (3000s, 8000s) para no chocar con Vite (5173), Ollama (11434), Letta (8283), Whisper (8765). Configurable por env var (`SHIRO_HOST_PORT`).
- **Path por defecto: `/bus`.** El servidor expone un único endpoint WS en `/bus`. Otros paths futuros (`/admin`, `/healthz`) podrían añadir HTTP regular.

## Notas de implementación

- `packages/core/src/core/transports/websocket-transport.ts` (PR 2):
  - Cliente-side. Usa el `WebSocket` global (browser).
  - Maneja reconexión con backoff exponencial.
  - Serializa salidas a envelope JSON; valida envelope entrantes con zod.
  - Implementa `ITransport`: `send`, `onReceive`, `close`.
- `packages/core-host/src/transports/ws-server-transport.ts` (PR 2):
  - Server-side. Usa el paquete `ws` (npm).
  - Acepta una conexión a la vez en V1 (si llega una segunda, la primera se cierra o se acepta también — TBD en PR 2, prefiero "ambas conviven en broadcast").
  - Implementa `ITransport` con la misma API que el cliente.
- `packages/core/src/core/transports/wire-schema.ts` (PR 2):
  - Schema zod del envelope, compartido entre ambos transports.
  - Exporta `WireEnvelopeSchema` y el tipo inferido.
- Puerto y path configurables por env: `SHIRO_HOST_PORT` (default `9876`), `SHIRO_HOST_PATH` (default `/bus`).

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — event-driven, base de la idea.
- [ADR 0003](0003-transport-abstraction-device-registry.md) — contrato `ITransport` que esto implementa.
- [ADR 0005](0005-typed-events-string-literals.md) — `EventMap` es la fuente de verdad de qué eventos existen.
- [ADR 0012](0012-split-cliente-server-core-host.md) — la decisión de partir cliente/server que motiva este protocolo.
- [WebSocket Protocol RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455) — la base sobre la que corre todo.
