# ADR 0017: Memoria persistente — LocalMemory (SQLite) + LettaMemory con fallback dinámico

- **Status**: Accepted
- **Fecha**: 2026-05-28
- **Decidido por**: Pipelol0723

## Contexto

Cerrado el hito LLM, Shiro ya conversa pero **olvida**. Cada turno se procesa sin contexto previo: el `LLMRequest.context` que prevé [ADR 0014](0014-llm-structured-output-text-emotion.md) y consume `wireConversationFlow` ([ADR 0016](0016-pipeline-conversational-wiring.md)) llega siempre vacío.

La pieza para resolverlo ya está esbozada:

- `IMemoryModule` ([`packages/core/src/interfaces/IMemoryModule.ts`](../../packages/core/src/interfaces/IMemoryModule.ts)) define `save / getRecent / searchSemantic? / clear` con un `userId` por entrada.
- `modules.config.yaml` ya tiene el slot:
  ```yaml
  memory:
    active: LettaMemory
    fallback_chain: [LocalMemory]
    config:
      letta_url: 'http://localhost:8283'
      local_db_path: './data/memory.db'
  ```

Toca decidir **cómo se materializa**: qué backends construimos, qué se guarda, cómo se recupera y cómo se sincroniza con el cliente.

### Restricciones reales

- **Docker no siempre está corriendo**. Letta vive en un contenedor; obligarlo en cada arranque rompe el "abre la app y funciona". Tiene que haber un camino sin Docker.
- **Hardware limitado**. GTX 1650 4 GB ya está ajustada con `qwen2.5:3b`. Cargar un modelo de embeddings local (nomic-embed-text, mxbai-embed-large) es VRAM extra que no nos sobra. Letta lo hace en su propio contenedor (CPU o GPU separado).
- **El cliente desktop hoy es session-local**. Si cerramos la app, el historial visible desaparece aunque el server lo persista.
- **Protocolo WebSocket congelado** ([ADR 0013](0013-protocolo-websocket-eventbus.md)): broadcast-everything, sin acks, sin subscriptions. Cualquier sync inicial tiene que pasar por el bus, no por extensiones del envelope.

## Decisión

**Dos backends (`LocalMemory` SQLite + `LettaMemory` HTTP) detrás de un `MemoryManager` que selecciona el activo en caliente; verbatim por turno; recuperación híbrida cronológica + semántica cuando Letta está; el server empuja `memory:snapshot` al cliente al conectar.**

### Backends

Dos implementaciones concretas de `IMemoryModule`, ambas registradas en el `ModuleLoader` ([ADR 0007](0007-module-loader-registry.md)):

- **`LocalMemory`** — SQLite vía `better-sqlite3`. Single-process, síncrono, sin servicios externos. Implementa `save / getRecent / clear`. **No implementa `searchSemantic`** (la interfaz lo permite, es opcional).
- **`LettaMemory`** — cliente HTTP contra Letta (Docker). Implementa los cuatro métodos incluyendo `searchSemantic` (Letta hace embeddings internamente con `mxbai-embed-large`).

### `MemoryManager` con fallback dinámico

Wrapper que también implementa `IMemoryModule` y delega al backend activo:

```typescript
class MemoryManager implements IMemoryModule {
  private active: 'letta' | 'local';
  constructor(
    private letta: LettaMemory,
    private local: LocalMemory,
  ) {
    /* … */
  }

  // Delegación pura — el método que se llame va al backend activo.
  save(entry) {
    return this[this.active === 'letta' ? 'letta' : 'local'].save(entry);
  }
  getRecent(userId, limit) {
    /* delega */
  }
  searchSemantic?(query, userId, limit) {
    if (this.active === 'letta') return this.letta.searchSemantic(query, userId, limit);
    return undefined; // LocalMemory no la soporta
  }
  clear(userId) {
    /* delega */
  }
}
```

Estado de arranque y health-check periódico:

1. Bootstrap intenta `letta.ping()` con timeout corto (~2s).
2. Si responde, `active = 'letta'`. Si no, `active = 'local'` y log `warn`.
3. Cada **30 segundos** vuelve a probar `letta.ping()`. Si Letta entra/sale, se actualiza `active`.
4. **Los turnos no se migran entre backends** al hacer swap. Cada almacén mantiene lo suyo; el siguiente turno persiste en el backend que esté activo en ese momento. Limitación conocida, documentada.

### Granularidad: verbatim

Un `MemoryEntry` por turno, sin transformaciones:

- `user:message` → `save({ role: 'user', text, timestamp, userId, metadata })`.
- `llm:responded` → `save({ role: 'assistant', text, timestamp, userId, metadata: { emotion, tier, latencyMs } })`.

Sin resúmenes, sin consolidación. Sencillo de auditar, reversible, sin latencia extra.

### Recuperación: híbrida cronológica + semántica

Cada turno, antes de invocar al LLM, el pipeline pide:

```
recent      = await memory.getRecent(userId, N)             // siempre
relevant    = await memory.searchSemantic?(text, userId, M) // si existe
context     = formatContextForLLM(recent, relevant)
llm.generate({ text, systemPrompt, context, userId })
```

Cuando Letta está, `searchSemantic` devuelve M entradas semánticamente relevantes (incluso antiguas). Cuando solo está LocalMemory, `searchSemantic` es `undefined` y el contexto se queda con los últimos N cronológicos. **Degradación silenciosa, no rotura**.

### Tamaños: N=5, M=3 (configurables)

Defaults conservadores en `modules.config.yaml`:

```yaml
memory:
  config:
    recent_limit: 5
    semantic_limit: 3
    snapshot_limit: 20 # cuántos turnos enviamos al cliente al conectar
```

Cambiar el valor no requiere recompilar — se ajusta tras observar uso real.

### Sync con cliente: `memory:snapshot` post-conexión

Nuevo evento tipado en `EventMap`:

```typescript
'memory:snapshot': { entries: MemoryEntry[]; userId: string }
```

Flujo:

1. Cliente abre la conexión WebSocket.
2. Server detecta nueva conexión (en `WebSocketServerTransport`).
3. Server hace `memory.getRecent(userId, snapshot_limit)` y emite `memory:snapshot` al bus. El `WebSocketServerTransport` lo entrega al cliente recién conectado.
4. Cliente recibe el evento; `useCompanionState` despacha `HYDRATE_FROM_MEMORY` al `companionReducer`, que **mapea `MemoryEntry[]` a `CompanionMessage[]`** y reemplaza `history` **solo si está vacío** (evita duplicar si ya hubo turnos en la sesión actual).

No tocamos el envelope WebSocket ([ADR 0013](0013-protocolo-websocket-eventbus.md)) — `memory:snapshot` es un evento más del bus.

### `userId` por ahora hardcodeado

El companion es de un solo dueño. El pipeline usa `userId: 'default'` constante. La interfaz mantiene el campo para multi-user futuro pero **no lo ejercitamos**.

## Alternativas consideradas

### Sobre el alcance del hito

- **Solo `LocalMemory` ahora, Letta más tarde**: descartada. Letta es la pieza con semántica y consolidación; sin ella, el `searchSemantic?` del contrato queda en el aire indefinidamente y el `LLMRequest.context` pierde la mitad de su valor. El usuario eligió tener la pieza buena lista.
- **Solo `LettaMemory`, sin `LocalMemory`**: descartada. Si Docker no está corriendo, Shiro se queda sin memoria. SQLite single-file es la red de seguridad.

### Sobre la recuperación

- **Solo cronológica (últimos N)**: descartada. Mensajes relevantes antiguos se pierden cuando la conversación crece. Letta nos da semántica gratis; aprovechamos.
- **Solo semántica**: descartada. Sin un mínimo de turnos cronológicos contiguos, el LLM pierde el hilo inmediato ("¿de qué hablábamos hace dos turnos?").
- **`LocalMemory` también con embeddings vía Ollama (`nomic-embed-text`)**: descartada. Otro modelo a descargar, más VRAM en uso, código de gestión de vectores en SQLite. El contrato `searchSemantic?` ya es opcional; sale más limpio dejar a LocalMemory en modo "solo cronológica" y dejar la semántica como upgrade que Letta aporta.

### Sobre la granularidad

- **Verbatim + resumen periódico cada N turnos (con LLM)**: descartada para esta versión. Añade otra ruta de fallo (la llamada al LLM resumidor), latencia extra y complejidad. Cuando Letta esté consolidado y el verbatim moleste, se reconsidera — Letta de hecho ya hace consolidación interna.
- **Solo resúmenes**: descartada. Perdemos fidelidad para depurar.

### Sobre el comportamiento si Letta no responde

- **Server falla con error claro**: descartada. Romper el arranque por una dependencia opcional es hostil cuando solo quieres probar localmente sin Docker.
- **Warning y carga `LocalMemory` permanentemente hasta reinicio**: descartada. Si arrancas Letta a mitad de sesión, sería absurdo no usarlo. Por eso el retry periódico.

### Sobre el sync con el cliente

- **Mantener cliente session-local (sin sync inicial)**: descartada. Memoria persistente que no se ve en la UI es media memoria. Cerrar y reabrir la app debe seguir mostrando lo que pasó antes.
- **Cliente pide explícitamente con `memory:request`**: descartada como diseño base — añade un round-trip y el cliente no tiene razón para no querer su historial al conectar. Reservado por si el futuro multi-user requiere distinguir "primer arranque" de "reload" antes de pedir nada.
- **Extender el envelope WebSocket con `kind=snapshot`**: descartada. Toca [ADR 0013](0013-protocolo-websocket-eventbus.md), añade un caso especial al protocolo y no aporta nada que un evento del bus no haga.

## Consecuencias

### Positivas

- **Shiro recuerda turnos previos**. Después de mergear este hito, el LLM recibe contexto real en cada llamada — primera conversación de verdad.
- **Cliente arranca con historial visible**. Cerrar y reabrir la app no pierde el chat.
- **Degradación graceful**. Sin Docker: SQLite local. Con Docker: Letta + semántica. Sin código condicional en el caller — `MemoryManager` lo maneja.
- **Interfaz ya cuajada**. `IMemoryModule` se diseñó pensando en esto; no necesita cambios.
- **Patrón de fallback chain estrenado**. El `MemoryManager` es la primera implementación real de la `fallback_chain` que el YAML lleva tiempo prometiendo; sirve de plantilla para TTS cuando llegue.

### Negativas / Riesgos

- **Letta como dependencia operativa**. Aunque no es obligatoria, cuando esté activa hay un contenedor más que gestionar, healthchecks, posible OOM en la máquina. Mitigación: el fallback a SQLite es el plan B real, no decorativo.
- **`better-sqlite3` requiere binarios nativos**. Builds en Windows/Mac/Linux funcionan pero el npm install es más lento. Mitigación: módulo asentado y mantenido; alternativa `node:sqlite` (Node 22+) está en consideración para una migración futura sin ADR.
- **Memoria infinita en LocalMemory**. Sin política de pruning, la DB crece para siempre. Mitigación: poda por edad/cantidad la hacemos cuando duela, no antes (probablemente nunca para un usuario individual).
- **Cambios de backend a media sesión pueden confundir** ("¿por qué este turno no recuerda el de hace 5 minutos?" si Letta cayó y el de antes lo guardó allí). Limitación conocida; documentada en el ADR y en el código.
- **`memory:snapshot` se emite también en re-conexiones** (no solo en primer arranque). El reducer compensa: solo hidrata si `history` está vacío. Cualquier nueva lógica que reaccione a `memory:snapshot` debe ser idempotente.

### Neutrales

- **`searchSemantic?` queda como contrato opcional**. La interfaz no cambia.
- **`cloud_threshold` del router sigue deprecated** ([ADR 0015](0015-hybrid-router-classifier-llm-based.md)); este ADR no lo toca.
- **`userId` queda en `'default'` constante**. Multi-user es post-MVP.

## Notas de implementación

### Paquete `core`

- `packages/core/src/modules/memory/local-memory.ts` — clase `LocalMemory`, schema SQL inline, `better-sqlite3` como dependencia.
- `packages/core/src/modules/memory/letta-memory.ts` — clase `LettaMemory`, `fetch` global, `ping()` para healthcheck.
- `packages/core/src/modules/memory/memory-manager.ts` — `MemoryManager`, intervalo de retry, swap del active.
- `packages/core/src/types/events.ts` — añadir `'memory:snapshot': { entries: MemoryEntry[]; userId: string }` al `EventMap`.
- Tests: `LocalMemory` con DB `:memory:`, `LettaMemory` con `fetch` mockeado, `MemoryManager` simulando Letta cayendo/volviendo.

### Paquete `core-host`

- `packages/core-host/src/bootstrap.ts` — registrar factories de `LocalMemory`, `LettaMemory` y `MemoryManager`; instanciar el manager con ambos backends.
- `packages/core-host/src/pipeline/conversation-flow.ts` — antes de `llm.generate`, llamar a `getRecent` y `searchSemantic?` y pasar `context`. Tras `llm:responded`, persistir user msg + assistant msg.
- `packages/core-host/src/server.ts` (o donde vive `WebSocketServerTransport`) — al detectar nueva conexión, emitir `memory:snapshot` con los últimos `snapshot_limit` turnos.

### Paquete `desktop`

- `packages/desktop/src/state/companion-reducer.ts` — nueva action `HYDRATE_FROM_MEMORY` que mapea `MemoryEntry[]` a `CompanionMessage[]`. Reemplaza `history` solo si está vacío.
- `packages/desktop/src/state/useCompanionState.ts` — `useBusEvent('memory:snapshot', …)` → dispatch `HYDRATE_FROM_MEMORY`.

### Config

- `config/modules.config.yaml` — añadir `recent_limit: 5`, `semantic_limit: 3`, `snapshot_limit: 20` bajo `memory.config`. El schema zod los valida con defaults.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — modular event-driven; la memoria vive como un módulo más.
- [ADR 0007](0007-module-loader-registry.md) — registry de factories que el `MemoryManager` usa.
- [ADR 0012](0012-split-cliente-server-core-host.md) — la memoria vive server-side por esto.
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — protocolo intacto; `memory:snapshot` viaja como evento del bus.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — el `LLMRequest.context` que este ADR rellena.
- [ADR 0016](0016-pipeline-conversational-wiring.md) — pipeline que se extiende con el wiring de memoria.
- Interfaz: [`packages/core/src/interfaces/IMemoryModule.ts`](../../packages/core/src/interfaces/IMemoryModule.ts).
- Letta: <https://docs.letta.com/> — servicio de memoria que usaremos como upgrade.
- `better-sqlite3`: <https://github.com/WiseLibs/better-sqlite3>.
