# ADR 0010: Wiring del cliente desktop con el EventBus del core

- **Status**: Accepted
- **Fecha**: 2026-05-26
- **Decidido por**: Pipelol0723

## Contexto

[ADR 0001](0001-arquitectura-modular-event-driven.md) estableció que la
comunicación entre módulos del core va por un `EventBus` pub/sub
tipado. [ADR 0008](0008-cliente-desktop-vite-react.md) decidió que el
cliente desktop es un paquete React separado que consume
`@proyecto-shiro/core`.

Falta definir **cómo el state del cliente sincroniza con el EventBus**:

- ¿El cliente instancia su propio EventBus? ¿O comparte el del core?
- ¿Cómo recibe los eventos? ¿Polling, subscripciones, reducer?
- ¿Cómo dispara acciones (`user:message`, "click en mic")?
- ¿Cómo se separa "estado del cliente" (qué pantalla está abierta) de
  "estado del companion" (emoción, está hablando, etc.)?

Si esto se hace mal, terminamos con dos estados desincronizados o con
una capa de glue tan compleja que rompe la modularidad que ganamos en
Fases 1A/1B.

El mockup ([`docs/design-mockup/project/app.jsx`](../design-mockup/project/app.jsx))
usa un `useReducer` con acciones que parecen 1:1 con eventos del
EventMap (`LISTEN_START`, `STT_PARTIAL`, `STT_FINAL`, `THINK_START`,
`SHIRO_REPLY`, `SPEAK_END`). Eso es la pista para la arquitectura
correcta.

## Decisión

**El cliente y el core comparten el mismo `EventBus` instanciado en el
core. El cliente se suscribe a eventos para alimentar su state, y
emite eventos cuando el usuario actúa.**

Concretamente:

### 1. Una sola instancia de `EventBus`

El cliente importa `EventBus`, `Logger`, `Orchestrator` desde
`@proyecto-shiro/core` y los instancia en su `main.tsx` (Fase 1A
producirá los hooks; Fase 2 conectará LLMs reales).

```ts
// packages/desktop/src/main.tsx (conceptual)
import { EventBus, Logger, InProcessTransport, Orchestrator } from '@proyecto-shiro/core';

const logger = new Logger();
const bus = new EventBus({ logger, transports: [new InProcessTransport()] });
const orchestrator = new Orchestrator({ bus, logger, ... });
```

El `<App>` React recibe `bus` y `orchestrator` por **context**, no por
props, para evitar prop-drilling.

### 2. Custom hook `useBusEvent` para suscribirse desde componentes

```ts
function useBusEvent<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void,
): void {
  const bus = useBus();
  useEffect(() => bus.on(event, handler), [bus, event, handler]);
}
```

Uso típico:

```tsx
function ConversationScreen() {
  const [emotion, setEmotion] = useState<Emotion>('neutral');

  useBusEvent('llm:responded', (p) => {
    setEmotion(p.emotion ?? 'neutral');
  });

  return <Orb emotion={emotion} />;
}
```

### 3. Reducer central para state compuesto, hooks individuales para state simple

Cuando el state involucra varios eventos coordinados (e.g. el flujo
listening → thinking → speaking), usar `useReducer` y suscribir el
reducer a los eventos. Para state derivado de un solo evento, basta
con `useState` + `useBusEvent`.

El mockup usa `useReducer` global — para Fase 1B inicial (sólo
`bus:ready`) bastaría con un hook simple, pero apuntamos al patrón
del mockup desde el principio para no refactorizar luego.

### 4. Separación de responsabilidades

| Tipo de state                | Vive en                            | Ejemplo                                     |
| ---------------------------- | ---------------------------------- | ------------------------------------------- |
| **Estado del companion**     | Reducer alimentado por el EventBus | emoción, hablando, escuchando, historial    |
| **Estado UI del cliente**    | useState local en cada pantalla    | pantalla actual, panel chat colapsado, tema |
| **Configuración persistida** | localStorage + sync al store       | tema preferido, modo de micro (PTT/VAD)     |
| **Sample/mock data**         | Fixtures aparte                    | mientras no hay módulos reales              |

### 5. Eventos del cliente (qué emite el cliente al core)

Inicialmente solo uno:

```ts
// nuevo evento, se añade al EventMap en este PR de seguimiento
'user:message': { text: string; userId: string };
```

Lo emite el cliente cuando:

- El usuario escribe y presiona Enter.
- El usuario habla y el STT entrega `isFinal: true`.

El módulo LLM (cuando exista, Fase 2) se suscribe a `user:message`,
procesa, emite `llm:responded`.

## Alternativas consideradas

- **Cada cliente con su propio EventBus + sincronización**: descartado.
  Doble book-keeping y la sincronización es un bug magnet. Hace sentido
  cuando los buses viven en procesos distintos (móvil contra core
  remoto) — pero en desktop son el mismo proceso, mismo bus.
- **State management externo (Redux / Zustand / Jotai)**: descartado
  por ahora. El EventBus ya cumple el rol de "store central". Añadir
  Redux es duplicar. Si en algún momento el state crece y un store
  dedicado ayuda, se evalúa con un ADR aparte.
- **El cliente llama directamente métodos del Orchestrator**: descartado.
  Rompe la modularidad event-driven. El cliente debería ser un módulo
  más, comunicándose por eventos como los otros.
- **Polling del core desde el cliente** (cada N ms): descartado, latencia
  innecesaria y pesadez en runtime.
- **WebSocket aunque sea en local**: descartado **por ahora**. Útil
  cuando el cliente y el core corran en procesos distintos (Fase 9
  con móvil; o Tauri con backend Rust separado del front JS).
  Mientras tanto, `InProcessTransport` cubre el caso desktop.

## Consecuencias

### Positivas

- **Sincronización imposible-de-romper**: hay un solo store de
  verdad (el EventBus). Lo que llega al cliente es exactamente lo
  que pasa en el core.
- **El cliente es testeable como un módulo más**: instancias un bus
  mock, emites eventos, verificas que el componente reacciona. Sin
  IPC, sin red, sin Tauri.
- **Cuando llegue mobile** (Fase 9, otro proceso), se cambia el
  transport (de `InProcessTransport` a `WebSocketTransport`) y el
  resto del cliente ni se entera. La arquitectura aguanta sin
  rediseño.
- **Patrón claro para clientes futuros**: cualquier paquete cliente
  (mobile, arduino-bridge, web) sigue el mismo modelo: importa el
  bus → instancia transports → suscribe componentes.

### Negativas / Riesgos

- **El cliente acaba con conocimiento de los nombres de evento**
  (e.g. `'llm:responded'`). Es esperado y aceptado: los eventos son
  el "API público" del core. Mitigación: el EventMap está tipado, los
  typos no compilan.
- **Si se añade un evento nuevo al core**, hay que decidir si el
  cliente debe escucharlo. Mitigación: code review y la convención de
  documentar cada evento nuevo en
  [`docs/architecture.md`](../architecture.md).

### Neutrales

- El `useReducer` del state del companion se parece mucho al del
  mockup. Bien — significa que la migración del prototipo al cliente
  real es casi mecánica.

## Notas de implementación

- Crear `packages/desktop/src/bus-context.tsx` con:
  - `BusProvider` que instancia el EventBus al montar.
  - `useBus()` hook que devuelve la instancia.
  - `useBusEvent(event, handler)` hook helper.
- El reducer del state del companion vive en
  `packages/desktop/src/state/companion-reducer.ts`.
- Tests de los hooks en `packages/desktop/tests/` (mocks del bus
  con `vi.fn()` siguiendo el patrón de Fase 1B).
- **Añadir `'user:message'` al `EventMap`** del core en el primer PR de
  implementación. Es un cambio menor pero hay que recordarlo: el
  cliente lo necesitará.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — pub/sub base.
- [ADR 0003](0003-transport-abstraction-device-registry.md) — por qué
  el InProcessTransport hoy y WebSocket cuando llegue móvil.
- [ADR 0005](0005-typed-events-string-literals.md) — el formato del
  EventMap que tipa los eventos compartidos.
- [ADR 0008](0008-cliente-desktop-vite-react.md) — stack del cliente.
- [`docs/design-mockup/project/app.jsx`](../design-mockup/project/app.jsx) —
  el reducer del mockup que inspira esta arquitectura.
