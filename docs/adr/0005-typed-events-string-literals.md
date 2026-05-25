# ADR 0005: Tipado de eventos con string literals y EventMap

- **Status**: Accepted
- **Fecha**: 2026-05-25
- **Decidido por**: Pipelol0723

## Contexto

[ADR 0001](0001-arquitectura-modular-event-driven.md) estableció que los
módulos del core se comunican vía un `EventBus` pub/sub. Cada evento
lleva un payload de forma específica (un evento `'llm:responded'` no
acarrea los mismos datos que `'stt:transcribed'`).

Hace falta una **convención de tipado** para que TypeScript valide:

1. Que el nombre del evento existe (no hay typos).
2. Que el payload coincide con la forma esperada para ese evento.
3. Que el handler que se suscribe recibe el tipo correcto inferido.

Adicionalmente, los eventos del bus terminarán viajando por red (cuando
llegue `WebSocketTransport` — ver [ADR 0003](0003-transport-abstraction-device-registry.md)),
así que el "nombre" del evento debe ser **serializable**: una string.

## Decisión

**Usar string literals como nombre de evento, con un `EventMap` central
que mapea cada string a su tipo de payload**.

```ts
// packages/core/src/types/events.ts
export type EventMap = {
  'stt:transcribed': { text: string; userId: string; isFinal: boolean };
  'llm:chunk': { text: string; userId: string };
  'llm:responded': { text: string; emotion: Emotion; userId: string };
  // ...
};

// Uso típico:
bus.emit('llm:responded', { text: 'hola', emotion: 'alegre', userId: 'u1' });
bus.on('llm:responded', (payload) => {
  /* payload tipado */
});
```

El `EventBus` se declara con generics sobre `EventMap`:

```ts
class EventBus<TMap extends Record<string, unknown>> {
  emit<K extends keyof TMap>(event: K, payload: TMap[K]): Promise<void> { ... }
  on<K extends keyof TMap>(event: K, handler: (p: TMap[K]) => void): Unsubscribe { ... }
}
```

### Convención de naming de eventos

Formato: `<modulo>:<verbo-pasado>`.

- Módulo en kebab-case, minúscula.
- Verbo en participio o pasado: `transcribed`, `responded`, `failed`.
- Eventos de chunks de stream usan presente: `chunk` o `tick`.

Ejemplos válidos: `'stt:transcribed'`, `'llm:chunk'`, `'tts:audio'`,
`'avatar:expression-changed'`, `'memory:saved'`, `'device:registered'`.

Inválidos: `'sttTranscribed'`, `'LLM_RESPONDED'`, `'transcribe-stt'`.

## Alternativas consideradas

- **Constantes enum-like** (`Events.LLM_RESPONDED = 'llm:responded'`):
  descartado. Añade verbosidad (`Events.LLM_RESPONDED` vs `'llm:responded'`),
  obliga a importar `Events` en cada archivo que emite o escucha, y no
  aporta seguridad de tipos adicional sobre la opción elegida (siempre
  que se evite hacer cast a `string` a mano).

- **Clases de evento** (`class LLMResponded { ... }; bus.emit(new
LLMResponded(...))`): descartado. Sobre-ingeniería para nuestro caso.
  Las clases no se serializan limpiamente para WebSocket/MQTT. Más
  memoria por evento. Estilo OOP que no encaja con el resto del código.

- **Sin tipado (any)**: descartado. Pierde toda la ventaja de TS.

- **Schemas runtime (zod) para validar payloads en cada `emit`**:
  evaluado y pospuesto. Es ideal cuando los eventos cruzan la red sin
  garantía de tipado (e.g., un cliente WebSocket externo). En el caso
  in-process, los tipos de TS son suficientes y validar runtime es
  overhead. **Cuando llegue `WebSocketTransport`, se evaluará validar
  con zod los eventos entrantes desde clientes remotos** (ADR aparte).

## Consecuencias

### Positivas

- **Type safety en compile-time**: typos en el nombre del evento o
  payload mal formado son errores de TypeScript, no bugs en runtime.
- **Autocompletado nativo**: `bus.emit('` te sugiere todos los eventos
  registrados.
- **Cero overhead en runtime**: los tipos se borran al compilar; los
  eventos son strings normales.
- **Refactor seguro**: renombrar una clave en `EventMap` actualiza
  todos los `emit`/`on` con el "rename symbol" del IDE.
- **Naming jerárquico legible**: `'stt:transcribed'` cuenta una
  historia. Filtrar logs por `'stt:*'` se vuelve trivial.
- **Serializable para transports remotos**: cuando un evento viaje
  por WebSocket o MQTT, su nombre ya es una string.

### Negativas / Riesgos

- **Si alguien hace `const x: string = 'llm:respnded'; bus.emit(x, ...)`**,
  TypeScript pierde la pista del tipo concreto. Mitigación: convención de
  no convertir a `string` a mano y revisarlo en code review.
- **El `EventMap` central crece con cada evento nuevo**. Riesgo:
  convertirse en un archivo monolítico. Mitigación: si supera ~30
  entradas, partir por dominio (`EventMap = STTEvents & LLMEvents &
...`).

### Neutrales

- Cualquier dev nuevo necesita conocer dónde está `EventMap` y la
  convención de naming. Se documenta en [`docs/architecture.md`](../architecture.md).

## Notas de implementación

- Ubicación: `packages/core/src/types/events.ts`.
- Re-exportado desde `packages/core/src/index.ts` para que clientes
  externos (futuro mobile, arduino-bridge) lo importen.
- Eventos definidos en Fase 1A (a medida que se necesiten):
  - Por ahora, **el EventMap arranca vacío o con un par de ejemplos**.
  - Se llena en Fase 2+ cuando se implementen los módulos concretos.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — la base que
  exige este tipado.
- [ADR 0003](0003-transport-abstraction-device-registry.md) — por qué
  los nombres de evento tienen que ser serializables (para que viajen
  por red en transports futuros).
