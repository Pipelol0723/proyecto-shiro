# ADR 0018: Corrección de la integración con Letta — SDK oficial, embeddings locales (Ollama) y auto-provisión del agente

- **Status**: Accepted
- **Fecha**: 2026-05-30
- **Decidido por**: Pipelol0723

## Contexto

El hito Memoria ([ADR 0017](0017-memoria-persistente-local-y-letta.md)) decidió la arquitectura **Letta canónico + LocalMemory como WAL**. Esa decisión sigue siendo válida. Lo que **no funciona** es la _implementación_ del cliente de Letta: `LettaMemory` se escribió a mano con `fetch` contra una forma de API asumida, y en la práctica da múltiples errores — la memoria nunca llega a activarse de verdad.

Diagnóstico tras revisar la API real de Letta (no de memoria — verificado contra la doc oficial):

1. **Embeddings obligatorios sin configurar.** La doc de Letta es explícita: _"When using Docker, you must specify an embedding model when creating agents"_. Archival memory depende de embeddings para guardar **y** buscar. Un agente sin embedding configurado hace que **cada `save` y `search` falle server-side**. Causa probable del grueso de los errores.
2. **Health path probablemente equivocado.** El código hace `GET /v1/health/check`; el endpoint real de Letta es `GET /v1/health/`. Si devuelve 404, `ping()` retorna `false` para siempre → `lettaUp` nunca pasa a `true` → no se empuja ni se lee nada, **aunque Letta esté sano**. Memoria inerte en silencio.
3. **Shapes de respuesta frágiles.** `searchSemantic` espera `{ results: [...] }` y `getRecent` un array pelado. Si la versión de Letta devuelve otra envoltura, el `zod.parse` lanza y el turno cae al fallback.
4. **Endpoints posiblemente deprecados.** El POST a `/v1/agents/{id}/archival-memory` con body `{ text, created_at, tags }` puede dar 422 (campos de más) o estar deprecado frente al modelo nuevo de **`/v1/archives/{archive_id}/passages`**.

La raíz común: **la API de Letta se mueve rápido y mantener paths/shapes/auth a mano es exactamente lo que rompe.** Además hay un requisito explícito del usuario: **la memoria debe estar activa el mayor tiempo posible** — hoy no se activa nunca.

Restricción de entorno: el dev principal trabaja en **Windows**, con **Ollama ya corriendo** en el host (`localhost:11434`) para el LLM local. Perfil local-first (privacidad, coste cero, GPU propia).

## Decisión

**Reemplazamos el cliente HTTP a mano por el SDK oficial `@letta-ai/letta-client`, configuramos Letta con embeddings locales vía Ollama, y auto-provisionamos el agente Letta al arrancar (persistiendo su id).** La arquitectura de [ADR 0017](0017-memoria-persistente-local-y-letta.md) (Letta canónico + WAL + drainer) **no cambia**; este ADR solo corrige _cómo_ hablamos con Letta.

Concreto:

### 1. SDK oficial en vez de `fetch` a mano

`LettaMemory` se reescribe sobre `@letta-ai/letta-client`. El SDK encapsula endpoints correctos, shapes de respuesta tipados, auth Bearer y reintentos, versionados con el servidor. Esto elimina de raíz las causas 2, 3 y 4 del diagnóstico, y convierte la causa 1 en un error claro y legible en vez de un fallo opaco.

- Cliente: `new LettaClient({ baseUrl, token })` (`token` = `LETTA_SERVER_PASSWORD`, que es como Letta self-hosted hace auth Bearer).
- Operaciones de archival memory (insert / list / search / delete) vía los métodos tipados del SDK. Los nombres exactos se fijan contra la versión instalada al implementar (leyendo los `.d.ts`), no se adivinan aquí.
- Se conserva la firma pública `IMemoryModule` + `ping()`. El resto del sistema (MemoryManager, pipeline) no se entera del cambio.

### 2. Embeddings locales vía Ollama (con `embedding_config` explícito)

Letta genera los embeddings con **Ollama** — 100% local, sin API key. La forma **fiable** (verificada end-to-end contra un Letta real) **no** es un handle de provider, sino un `embedding_config` **explícito** al crear el agente:

```
embedding_endpoint_type: 'openai'
embedding_endpoint:      'http://host.docker.internal:11434/v1'
embedding_model:         'mxbai-embed-large'
embedding_dim:           1024
```

- **Por qué explícito y no un handle `ollama/…`**: el provider nativo de Letta enruta el embedding por su cliente OpenAI hacia `{OLLAMA_BASE_URL}/embeddings` **sin** `/v1` → Ollama responde `404 page not found` → 500 en cada `save`. La config explícita apunta directa a `/v1/embeddings` (que sí existe en Ollama) con el **nombre real** del modelo. Esto fue el origen de "tantos errores".
- El usuario hace `ollama pull mxbai-embed-large`. El endpoint usa `host.docker.internal` (no `localhost`) porque es desde la **perspectiva del contenedor** Letta, no del host.
- El agente exige además un **LLM handle** (`ollama/qwen2.5:3b`) aunque nunca generemos con él (el LLM es nuestro, ADR 0017).
- Ventaja extra: la config explícita funciona **aunque el contenedor Letta tenga una config de providers enredada** — no dependemos de cómo Letta auto-descubre los handles.

### 3. Auto-provisión del agente

Hoy `agent_id` es un campo obligatorio que el usuario crea a mano en la UI de Letta y pega en el YAML — barrera de setup y fuente de errores. Cambiamos a:

- Si `agent_id` está configurado en el YAML → se usa tal cual (override explícito).
- Si está vacío → al arrancar, `LettaMemory` **crea el agente** con `client.agents.create({ model, embedding, contextWindowLimit })`, persiste el id devuelto, y loguea prominentemente el id creado.
- El id se persiste en una tabla `meta` (clave-valor) dentro del SQLite de `LocalMemory` — transaccional con el WAL, sobrevive reinicios, no muta archivos de config del usuario.

Resultado: en un setup limpio (Letta arriba + Ollama + modelo de embed pulled), la memoria **se activa sola** sin pasos manuales.

### 4. Operación "siempre activa"

Para cumplir el requisito de máxima disponibilidad:

- **`docker-compose.yml`** para Letta con `restart: unless-stopped`, volumen para Postgres, las env de Ollama y password, y un `healthcheck` apuntando a `/v1/health/`.
- El **WAL + drainer** existente se mantiene intacto: es la póliza contra hiccups de Letta (cero turnos perdidos). Se beneficia del health detection corregido.
- Healthcheck corregido a `GET /v1/health/`.

## Alternativas consideradas

- **Parchear el cliente `fetch` a mano** (arreglar health path, shapes y body sin dependencia nueva): descartada. Más rápido hoy, pero seguimos manteniendo a mano una API que se mueve — volveríamos a romper en el próximo bump de Letta. El SDK traslada ese mantenimiento al equipo de Letta.
- **Vector store local simple** (`sqlite-vec` / `pgvector` en vez de Letta): descartada _por ahora_. Es verdad que el código solo usa Letta como store de passages y no toca lo que la hace especial (core memory editable, consolidación). Pero [ADR 0017](0017-memoria-persistente-local-y-letta.md) eligió Letta a propósito por esas features a futuro. Si tras este ADR Letta sigue dando guerra operativa, se reabre con un ADR que lo supersede.
- **Embeddings vía OpenAI** (default de Letta, cero config de Ollama): descartada. Rompe el local-first, cuesta dinero por uso y manda cada turno a OpenAI para vectorizar. El usuario ya tiene Ollama corriendo; el coste marginal es `ollama pull mxbai-embed-large`.
- **Usar el flujo de agente de Letta para generar** (en vez de solo archival): descartada — ya decidido en ADR 0017. El LLM es nuestro (Ollama/Anthropic vía HybridRouter); Letta es store, no cerebro.
- **Mantener `agent_id` manual**: descartada. Es una barrera de setup y una causa de "no arranca" cuando el id está mal. Auto-provisión con override explícito da lo mejor de ambos.

## Consecuencias

### Positivas

- **La memoria por fin se activa.** Embeddings configurados + endpoints correctos + health detection correcto = saves y reads funcionan.
- **Menos mantenimiento.** El versionado de la API lo absorbe el SDK, no nosotros.
- **Setup casi cero.** Auto-provisión: levantas Letta + pulleas el modelo de embed y arranca; sin pegar ids a mano.
- **Local-first intacto.** Embeddings en tu GPU, nada sale a la nube.
- **Disponibilidad alta.** `restart: unless-stopped` + WAL + drainer + healthcheck correcto.

### Negativas / Riesgos

- **Nueva dependencia** (`@letta-ai/letta-client`) en `@proyecto-shiro/core`. Peso y superficie. Mitigación: es la dependencia canónica y bien mantenida del servicio que ya elegimos.
- **Gotchas conocidos de Letta+Ollama.** P.ej. [issue #2388](https://github.com/letta-ai/letta/issues/2388): Letta a veces ignora `OLLAMA_BASE_URL` y cae a OpenAI. Mitigación: documentar en README + verificar en el healthcheck de arranque que el embedding responde.
- **Cold-start de embeddings.** Ollama descarga el modelo tras ~5 min de inactividad; el primer `searchSemantic` tras una pausa paga varios segundos y puede expirar (el WAL cubre los saves; el recall semántico de ese turno se pierde). Mitigaciones implementadas: _warm-up_ del embedding al quedar listo el agente, timeout **individual** por lectura en el pipeline (un `searchSemantic` frío ya no arrastra al `getRecent` barato), y `lettaUp` desacoplado de los timeouts de operación (solo el ping decide up/down, sin parpadeo). Para recall siempre instantáneo: `OLLAMA_KEEP_ALIVE=-1`.
- **El agente necesita un LLM handle válido** aunque no lo usemos. Si el modelo no existe en Ollama, la creación del agente falla. Mitigación: reusar `qwen2.5:3b` que el usuario ya tiene.
- **Más piezas operativas** (Docker + Postgres dentro de Letta + Ollama). Es el coste de Letta; ya asumido en ADR 0017.
- **`@proyecto-shiro/core` es browser-safe en parte.** El SDK de Letta debe vivir solo en el path Node (igual que `better-sqlite3`). Hay que verificar que no se filtra al bundle del cliente — `LettaMemory` ya es server-side, pero el import hay que ubicarlo bien (entry `./node` o módulo no importado desde el browser).

### Neutrales

- **Enmienda las "Notas de implementación" de ADR 0017** (el cliente Letta), sin tocar su decisión central. ADR 0017 queda `Accepted`; este lo complementa.
- **`agent_id` pasa de obligatorio-manual a auto-provisionado** con override opcional.
- **El config schema de `letta` gana campos** para los handles de Ollama (`embedding`, `model`) y `context_window_limit`.

## Notas de implementación

Mapa de dónde tocar (el detalle vive con el código):

### `core`

- `packages/core/package.json` — añadir `@letta-ai/letta-client`.
- `packages/core/src/modules/memory/letta-memory.ts` — reescribir sobre el SDK; conservar `IMemoryModule` + `ping()`; corregir health a `/v1/health/`; auto-provisión del agente.
- `packages/core/src/modules/memory/local-memory.ts` — tabla `meta(key TEXT PRIMARY KEY, value TEXT)` para persistir el `agent_id` auto-provisionado; métodos `getMeta/setMeta`.
- `packages/core/src/modules/memory/memory-manager.ts` — el manager orquesta la provisión del agente en `checkLetta()` (vía `ensureAgent()`), persistiendo el id en el WAL. `LettaMemoryConfigSchema` (en `letta-memory.ts`) gana `model`, `embedding_endpoint`, `embedding_model`, `embedding_dim`, `context_window_limit`.
- Tests: `LettaMemory` con el SDK mockeado (insert/list/search/delete + provisión); `MemoryManager` con provisión simulada.

### `core-host`

- `packages/core-host/src/bootstrap.ts` — sin cambios estructurales (el manager ya tiene lifecycle); verificar el import del SDK por el path Node.

### Config / infra

- `config/modules.config.yaml` — bloque `memory.config.letta` con `model: 'ollama/qwen2.5:3b'`, `embedding_endpoint: 'http://host.docker.internal:11434/v1'`, `embedding_model: 'mxbai-embed-large'`, `embedding_dim: 1024`, `context_window_limit`.
- `docker-compose.yml` (nuevo, raíz) — servicio `letta` con `restart: unless-stopped`, volumen pgdata, `OLLAMA_BASE_URL`, `SECURE`, `LETTA_SERVER_PASSWORD`, healthcheck `/v1/health/`.
- `.env.example` — `LETTA_SERVER_PASSWORD`, `LETTA_BASE_URL`.

### Docs

- `README.md` — sección "Arrancar Letta (memoria)": `docker compose up letta`, `ollama pull mxbai-embed-large`, gotcha de `host.docker.internal` en Windows, verificación con `curl .../v1/health/`.
- `docs/architecture.md` — diagrama del flujo `pipeline → MemoryManager → (SDK) Letta` con la rama WAL → SQLite → drainer.

## Referencias

- [ADR 0017](0017-memoria-persistente-local-y-letta.md) — arquitectura de memoria que este ADR corrige a nivel de implementación.
- Letta — Deploy con Docker: <https://docs.letta.com/guides/selfhosting/>
- Letta — Proveedor Ollama: <https://docs.letta.com/guides/server/providers/ollama/>
- Letta — TypeScript SDK: <https://docs.letta.com/api/typescript> · npm `@letta-ai/letta-client`
- Letta — gotcha `OLLAMA_BASE_URL`: <https://github.com/letta-ai/letta/issues/2388>
