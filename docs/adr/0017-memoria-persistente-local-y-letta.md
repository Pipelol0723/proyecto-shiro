# ADR 0017: Memoria persistente — Letta canónico con LocalMemory como WAL de continuidad

- **Status**: Accepted
- **Fecha**: 2026-05-29
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

Toca decidir **cómo se materializa**: qué papel juegan ambos backends, qué se guarda, cómo se recupera y cómo se sincroniza con el cliente.

### Restricciones reales

- **Objetivo a largo plazo**: "recordar todo lo que pueda". Memoria es protagonista del producto, no accesorio. Pérdida de turnos = pérdida de valor.
- **Proyecto multi-cliente por diseño**. Hoy hay un desktop; en el roadmap entran móvil, Arduino bridge e IoT bridge. Todos conectan al mismo `core-host` por WebSocket ([ADR 0012](0012-split-cliente-server-core-host.md), [ADR 0013](0013-protocolo-websocket-eventbus.md)). Necesitamos **una memoria centralizada y compartida**, no una por superficie.
- **Docker disponible de forma estable**. El usuario puede mantener el contenedor de Letta corriendo permanentemente; la pregunta "y si Docker no está" deja de ser bloqueante, pero "y si Letta reinicia o tiene un hiccup" sigue siendo un riesgo real (updates, errores puntuales, reinicios).
- **Hardware en transición**. La VRAM no será el cuello de botella inmediato; embeddings remotos (en el contenedor de Letta) o locales son ambos viables.
- **Protocolo WebSocket congelado** ([ADR 0013](0013-protocolo-websocket-eventbus.md)): broadcast-everything, sin acks, sin subscriptions. Cualquier sync inicial tiene que pasar por el bus, no por extensiones del envelope.

## Decisión

**Letta es el almacén canónico de memoria (cronológica, semántica, core memory, consolidación). `LocalMemory` (SQLite) es un write-ahead log invisible al path normal: cada turno se persiste primero en SQLite y se empuja inmediatamente a Letta; un drainer en background reenvía las entradas pendientes si Letta tartamudea. Cero turnos perdidos. El server empuja `memory:snapshot` al cliente al conectar.**

### Letta como almacén canónico

Concreto:

- **Lectura cronológica** (`getRecent`) → Letta.
- **Lectura semántica** (`searchSemantic`) → Letta. Embeddings con `mxbai-embed-large` (default de Letta).
- **Core memory** (datos del usuario siempre presentes en el system prompt) → Letta. El LLM puede escribirla con tool calls.
- **Consolidación / archival** (resúmenes automáticos cuando el log crece) → Letta.
- **Snapshot al cliente al conectar** → Letta.

`LettaMemory` implementa `IMemoryModule` completo (los cuatro métodos incluyendo `searchSemantic`) y expone además un `ping()` para healthcheck.

### `LocalMemory` como WAL de continuidad

`LocalMemory` (SQLite vía `better-sqlite3`) **no se lee desde el path normal**. Su único rol es ser una cola persistente:

1. Cada `save()` escribe primero a SQLite (síncrono, <1ms).
2. Inmediatamente se intenta empujar a Letta.
3. Si Letta confirma, la fila local se marca `synced_at = now()`.
4. Si Letta falla (timeout, 5xx, contenedor reiniciándose), la fila queda con `synced_at = NULL` y un drainer la procesará después.

Cuando todo va bien, la tabla local es estado transitorio — entradas con `synced_at` se podan periódicamente (o nunca, según convenga; el coste de mantener ~años de turnos en SQLite es despreciable y sirve de respaldo offline contra cualquier evento catastrófico de Letta).

`LocalMemory` implementa **solo `save / clear`** (no expone `getRecent` ni `searchSemantic`); el contrato `IMemoryModule` se cumple en el wrapper, no en esta clase aislada.

### `MemoryManager` con write-ahead log

Wrapper que implementa `IMemoryModule` y orquesta el WAL:

```
class MemoryManager implements IMemoryModule:
  save(entry):
    1. localMemory.save(entry)              # SQLite, síncrono, devuelve ya
    2. enqueueForLetta(entry)               # fire-and-forget al drainer
    3. resolve

  getRecent(userId, limit):
    return letta.getRecent(userId, limit)   # Letta es la verdad

  searchSemantic(query, userId, limit):
    return letta.searchSemantic(query, userId, limit)

  clear(userId):
    await Promise.all([
      letta.clear(userId),
      localMemory.clear(userId),
    ])
```

El drainer:

- Worker en background (loop con `setInterval`).
- Cada ~5 segundos: si hay entradas con `synced_at IS NULL`, intenta empujarlas a Letta en orden cronológico.
- Si Letta no responde (`ping()` falla), espera al siguiente ciclo. No bloquea, no escala el intervalo (lineal y predecible).
- Si Letta confirma, marca la fila local como sincronizada.
- Logging mínimo: solo cambio de estado ("Letta down — N entradas pendientes" / "Letta up — drenando N entradas").

### `MemoryEntry` gana un `id`

Para deduplicar al sincronizar (caso típico: el manager ya envió a Letta pero perdió la respuesta por timeout; reintentar duplicaría):

```typescript
interface MemoryEntry {
  id: string; // UUID v7 generado al construir el entry, antes del save
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  userId: string;
  metadata?: Record<string, unknown>;
}
```

UUID v7 (ordenable por tiempo) — ordenación local barata, idempotencia en Letta porque el `id` se manda como clave externa.

### Schema SQLite

```sql
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,              -- UUID v7
  user_id      TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  text         TEXT NOT NULL,
  timestamp    TEXT NOT NULL,                 -- ISO 8601
  metadata     TEXT,                          -- JSON
  synced_at    TEXT                           -- ISO 8601 cuando Letta confirma; NULL = pendiente
);

CREATE INDEX idx_messages_pending ON messages(synced_at) WHERE synced_at IS NULL;
CREATE INDEX idx_messages_user_time ON messages(user_id, timestamp);
```

El índice parcial sobre `synced_at IS NULL` mantiene el drainer barato — escanea solo lo no sincronizado.

### Granularidad: verbatim

Un `MemoryEntry` por turno, sin transformaciones por nuestra parte:

- `user:message` → `save({ id: uuid, role: 'user', text, timestamp, userId, metadata })`.
- `llm:responded` → `save({ id: uuid, role: 'assistant', text, timestamp, userId, metadata: { emotion, tier, latencyMs } })`.

La consolidación / summarization la hace **Letta** internamente cuando el archival crece. Nosotros guardamos verbatim; Letta decide cuándo comprimir.

### Recuperación: cronológica + semántica desde Letta

Cada turno, antes de invocar al LLM, el pipeline pide:

```
recent      = await memory.getRecent(userId, N)            // Letta
relevant    = await memory.searchSemantic(text, userId, M) // Letta
context     = formatContextForLLM(recent, relevant)
llm.generate({ text, systemPrompt, context, userId })
```

Si Letta no responde dentro de un timeout corto (~1.5s), el pipeline procede **sin contexto** (mensaje guardado igual gracias al WAL, simplemente Shiro responde "ciego" ese turno). Logueado como warn. No rompe el turno.

### Tamaños: N=5, M=3 (configurables)

Defaults conservadores en `modules.config.yaml`:

```yaml
memory:
  config:
    recent_limit: 5
    semantic_limit: 3
    snapshot_limit: 20 # cuántos turnos enviamos al cliente al conectar
    drainer_interval_ms: 5000 # cada cuánto el drainer intenta empujar pendientes
    letta_timeout_ms: 1500 # timeout de reads en el hot path del LLM
```

Cambiar el valor no requiere recompilar.

### Sync con cliente: `memory:snapshot` post-conexión

Nuevo evento tipado en `EventMap`:

```typescript
'memory:snapshot': { entries: MemoryEntry[]; userId: string }
```

Flujo:

1. Cliente abre la conexión WebSocket.
2. Server detecta nueva conexión (en `WebSocketServerTransport`).
3. Server hace `memory.getRecent(userId, snapshot_limit)` (que va a Letta) y emite `memory:snapshot` al bus. El `WebSocketServerTransport` lo entrega al cliente recién conectado.
4. Cliente recibe el evento; `useCompanionState` despacha `HYDRATE_FROM_MEMORY` al `companionReducer`, que mapea `MemoryEntry[]` a `CompanionMessage[]` y reemplaza `history` **solo si está vacío** (evita duplicar si ya hubo turnos en la sesión actual).

No tocamos el envelope WebSocket ([ADR 0013](0013-protocolo-websocket-eventbus.md)) — `memory:snapshot` es un evento más del bus.

### `userId` por ahora hardcodeado

El companion es de un solo dueño. El pipeline usa `userId: 'default'` constante. La interfaz mantiene el campo para multi-user futuro pero **no lo ejercitamos**.

## Alternativas consideradas

### Sobre el alcance del hito

- **Solo `LocalMemory` ahora, Letta más tarde**: descartada. Letta es la pieza con core memory editable, consolidación automática y semántica de calidad — exactamente lo que el objetivo "recordar todo lo más posible a largo plazo" pide. Aplazarla deja el hito a medias.
- **Solo `LettaMemory`, sin WAL local**: descartada. Cuando Letta reinicia (updates, restarts del contenedor, errores puntuales), los turnos de esos segundos se perderían. Para un proyecto cuyo objetivo es "no olvidar nada", la pérdida no es aceptable. El WAL es barato como póliza.

### Sobre la arquitectura entre backends

- **Write-through dual síncrono** (escribir a ambos antes de devolver): descartada. Cada turno pagaría la latencia de Letta (red + embeddings) en el hot path. El WAL asíncrono da la misma garantía de no-pérdida sin colgar la conversación.
- **`LocalMemory` también con búsqueda semántica vía Ollama embeddings**: descartada. Duplica lo que Letta hace mejor. La semántica vive en Letta; LocalMemory solo persiste.
- **Migración one-shot al volver Letta** (sin loop de background, solo al detectar swap): descartada. Requiere un evento de "swap" claro y deja ventanas de inconsistencia. El loop periódico es más simple y predecible.
- **Sync bidireccional** (Letta → Local también, para snapshot rápido al cliente): descartada para V1. El snapshot al conectar puede pagar la latencia de Letta sin problema (~100-300ms). Si en el futuro duele, se introduce un cache local de lectura sin reescribir el ADR.

### Sobre la recuperación

- **Solo cronológica (últimos N)**: descartada. Mensajes relevantes antiguos se pierden cuando la conversación crece. Letta da semántica gratis.
- **Solo semántica**: descartada. Sin un mínimo de turnos cronológicos contiguos, el LLM pierde el hilo inmediato ("¿de qué hablábamos hace dos turnos?").

### Sobre la granularidad

- **Verbatim + resumen periódico nuestro (con LLM)**: descartada. Letta ya consolida internamente; duplicaríamos lógica. Si en el futuro queremos control sobre cómo se resume, se reconsidera.
- **Solo resúmenes**: descartada. Perdemos fidelidad para depurar y reentrenar a Letta si cambiamos backend.

### Sobre el comportamiento si Letta no responde

- **Server falla con error claro**: descartada. Romper el arranque por un hiccup de Letta es hostil cuando hay un WAL que sigue salvando turnos.
- **Bloquear el turno hasta que Letta responda**: descartada. Latencia perceptible y mala UX. Mejor responder sin contexto y guardar el turno; cuando Letta vuelva, el contexto vuelve en el siguiente turno.

### Sobre el sync con el cliente

- **Mantener cliente session-local (sin sync inicial)**: descartada. Memoria persistente que no se ve en la UI es media memoria.
- **Cliente pide explícitamente con `memory:request`**: descartada como diseño base. Push automático evita un round-trip y siempre quieres tu historial al conectar.
- **Extender el envelope WebSocket con `kind=snapshot`**: descartada. Toca [ADR 0013](0013-protocolo-websocket-eventbus.md) sin ganancia frente a un evento del bus.

## Consecuencias

### Positivas

- **Cero turnos perdidos**. Letta puede reiniciar, perder red, dar un hiccup — el WAL captura y reenvía.
- **Hot path rápido**. `save()` devuelve en sub-ms (SQLite); el push a Letta no bloquea la conversación.
- **Shiro recuerda turnos previos con calidad real**. Core memory editable + semántica de Letta + cronológica reciente.
- **Cliente arranca con historial visible**. Cerrar y reabrir la app no pierde el chat.
- **Multi-cliente by default**. Cuando aparezca el móvil, Arduino o robot, conectan al mismo `core-host` por WS, hablan con el mismo Letta. Ningún diseño nuevo.
- **Seguro contra lock-in de Letta**. Si Letta cambia drásticamente o quieres migrar a otro backend, el log crudo está en SQLite — migración posible.

### Negativas / Riesgos

- **Complejidad del drainer**. Un loop de background, un índice parcial, manejo de errores de red. Aislado en una clase, pero pieza que mantener.
- **Letta como dependencia operativa real**. Aunque hay WAL, los reads dependen de Letta — si Letta está caído mucho rato, el LLM responde sin contexto y la experiencia degrada. Mitigación: monitoreo básico, retry, alertas en log cuando el backlog crezca.
- **Doble escritura en disco**. Cada turno toca SQLite y Letta. Storage barato pero no cero.
- **Potencial drift de schema entre SQLite y Letta**. Si Letta cambia su modelo de datos, el push del drainer puede romper. Mitigación: la API de Letta es estable; cambios mayores se reflejarían en bump de versión del cliente HTTP.
- **`memory:snapshot` se emite también en re-conexiones** (no solo en primer arranque). El reducer compensa: solo hidrata si `history` está vacío. Cualquier nueva lógica que reaccione a este evento debe ser idempotente.

### Neutrales

- **`searchSemantic?` deja de ser opcional en la práctica**. La interfaz lo mantiene opcional por contrato, pero el `MemoryManager` siempre lo expone (delegando a Letta).
- **`cloud_threshold` del router sigue deprecated** ([ADR 0015](0015-hybrid-router-classifier-llm-based.md)); este ADR no lo toca.
- **`userId` queda en `'default'` constante**. Multi-user es post-MVP.
- **`MemoryEntry` gana `id: string`**. Cambio menor del contrato; las implementaciones existentes (`NoopMemory`) lo generan vacío o con un placeholder; los tests se ajustan.

## Consideraciones futuras (fuera del alcance de este ADR)

Estos puntos se decidirán **cuando aparezcan los clientes correspondientes**, no antes. La arquitectura actual los habilita sin diseño extra; lo que cambiará es la operativa.

- **Memoria offline en clientes "móviles"** (robot operando sin red al servidor, Arduino con conexión intermitente). Cada cliente podría mantener su propio WAL local y sincronizar al volver — patrón equivalente al que aquí montamos en el server, replicado en el edge. Decisión real cuando el robot exista y sepamos qué autonomía necesita.
- **`clientId` / `deviceId` en `MemoryEntry`** (saber si Pipe dijo X desde el desktop, el móvil o el robot). Añadir un campo opcional a `MemoryEntry` cuando aparezca el segundo cliente es trivial — migración SQL de una columna con default `'unknown'` para entradas viejas.
- **Multi-agente en Letta** (un agente Shiro por superficie vs un solo Shiro compartido). Letta lo soporta nativo. Decisión depende de qué se sienta mejor cuando haya dos clientes funcionando.

No los planeamos hoy: hacerlo sin tener las superficies reales = adivinar abstracciones.

## Notas de implementación

### Paquete `core`

- `packages/core/src/interfaces/IMemoryModule.ts` — añadir `id: string` a `MemoryEntry`.
- `packages/core/src/modules/memory/local-memory.ts` — clase `LocalMemory` (solo `save / clear`), schema SQL inline, `better-sqlite3` como dependencia.
- `packages/core/src/modules/memory/letta-memory.ts` — clase `LettaMemory` (los cuatro métodos + `ping()`), `fetch` global.
- `packages/core/src/modules/memory/memory-manager.ts` — `MemoryManager` con drainer, expone `IMemoryModule` completo.
- `packages/core/src/types/events.ts` — añadir `'memory:snapshot': { entries: MemoryEntry[]; userId: string }` al `EventMap`.
- Tests: `LocalMemory` con DB `:memory:`, `LettaMemory` con `fetch` mockeado, `MemoryManager` simulando Letta cayendo/volviendo y validando que el drainer drena en orden y marca `synced_at`.

### Paquete `core-host`

- `packages/core-host/src/bootstrap.ts` — registrar factories de `LocalMemory`, `LettaMemory` y `MemoryManager`; instanciar el manager con ambos backends; arrancar el drainer.
- `packages/core-host/src/pipeline/conversation-flow.ts` — antes de `llm.generate`, llamar a `getRecent` y `searchSemantic` con timeout; pasar `context`. Tras `llm:responded`, persistir user msg + assistant msg.
- `packages/core-host/src/server.ts` (o donde vive `WebSocketServerTransport`) — al detectar nueva conexión, emitir `memory:snapshot` con los últimos `snapshot_limit` turnos.

### Paquete `desktop`

- `packages/desktop/src/state/companion-reducer.ts` — nueva action `HYDRATE_FROM_MEMORY` que mapea `MemoryEntry[]` a `CompanionMessage[]`. Reemplaza `history` solo si está vacío.
- `packages/desktop/src/state/useCompanionState.ts` — `useBusEvent('memory:snapshot', …)` → dispatch `HYDRATE_FROM_MEMORY`.

### Config

- `config/modules.config.yaml` — actualizar bloque `memory.config` con `recent_limit`, `semantic_limit`, `snapshot_limit`, `drainer_interval_ms`, `letta_timeout_ms`. El schema zod los valida con defaults.

### Documentación operativa

- README: sección de cómo arrancar Letta (docker compose snippet, healthcheck).
- `docs/architecture.md`: diagrama mermaid del flujo `pipeline → MemoryManager → Letta` con la rama WAL → SQLite → drainer.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — modular event-driven; la memoria vive como un módulo más.
- [ADR 0007](0007-module-loader-registry.md) — registry de factories que el `MemoryManager` usa.
- [ADR 0012](0012-split-cliente-server-core-host.md) — la memoria vive server-side por esto.
- [ADR 0013](0013-protocolo-websocket-eventbus.md) — protocolo intacto; `memory:snapshot` viaja como evento del bus.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — el `LLMRequest.context` que este ADR rellena.
- [ADR 0016](0016-pipeline-conversational-wiring.md) — pipeline que se extiende con el wiring de memoria.
- Interfaz: [`packages/core/src/interfaces/IMemoryModule.ts`](../../packages/core/src/interfaces/IMemoryModule.ts).
- Letta: <https://docs.letta.com/> — servicio de memoria canónico.
- `better-sqlite3`: <https://github.com/WiseLibs/better-sqlite3>.
