# ADR 0022: Shiro agentic — slot `tools:`, FS + shell con permisos mixtos

- **Status**: Accepted
- **Fecha**: 2026-06-09
- **Decidido por**: Pipelol0723
- **Implementado**: 2026-06-15 (PRs #1–#8 del hito agentic)

## Contexto

Cerrado el hito **Avatar Live2D**, Shiro ya tiene cara (Live2D + lip-sync + expresiones), voz (ElevenLabs + SystemTTS) y memoria (Letta + WAL local). Es una _interlocutora_ — escucha, piensa, responde. Falta el salto a _agente_: que pueda **leer, modificar e interactuar con el sistema** del usuario. El usuario lo describe como "estilo OpenInterpreter / Open Claw" — Shiro deja de ser solo una VTuber-chat y pasa a ser una companion que actúa.

Este ADR se escribe **antes del hito Packaging Tauri** a propósito: las decisiones que Packaging debe tomar (permisos `tauri.conf.json`, FS scope, shell allowlist, CSP del Webview, firma del auto-updater) cambian radicalmente si el binario distribuido va a ser solo VTuber-chat o si tiene que sostener un agente. Sin este ADR, el primer release del MVP queda con permisos mínimos, y abrirlos retroactivamente rompe la cadena de updates firmados.

### Estado del que partimos

- **Slots actuales del orchestrator** (`packages/core/src/core/orchestrator.ts`): `llmLocal`, `llmCloud`, `router`, `stt`, `tts`, `memory`, `avatar`. **No hay slot ni interface para herramientas.**
- **Interfaces existentes** (`packages/core/src/interfaces/`): `ITransport`, `IEventBus`, `ILLMModule`, `IRouterModule`, `ISTTModule`, `ITTSModule`, `IMemoryModule`, `IAvatarModule`, `IDeviceModule`. Ninguna toca tools, FS, shell o ejecución.
- **HybridRouter** decide local vs cloud por longitud + keywords de razonamiento — **no considera tool-use**. Hoy local puede recibir cualquier query corta sin filtro.
- **Character YAML** (`default.yaml`): solo perfil conversacional. No hay sección de capacidades, herramientas o permisos.
- **Cliente desktop** ya tiene patrón de modales conversacionales (botón mute, botón mic). Añadir un modal de "Shiro quiere ejecutar X — ¿permites?" es bajo coste UI.

### Restricciones reales

- **Modelo local no hace tool-use fiable**. Qwen 2.5 3b intenta el formato JSON pero alucina argumentos y nombres de tool con frecuencia. Forzar tool-use por local en V1 produciría una experiencia rota. Tools modernas en local requieren al menos qwen3-coder / Llama 3.3 70b — y eso necesita la RTX 5080 + > 16 GB VRAM que el usuario aún no tiene.
- **Costo de Claude por turno agentic**. Cada turno con tool_use puede generar 2-4 round-trips al API. Aceptable para un companion personal con uso moderado; insostenible si se vuelve actividad principal del día.
- **Equipo de 2 personas, 4-6 h/semana**. El hito agentic es no-trivial: contrato `IToolModule`, registry, integración con el pipeline (loop tool-use), UI de aprobación, persistencia de tool_calls, tests. ~5-7 PRs de envergadura.
- **Blast radius**. Si Shiro borra un archivo por equivocación, daña archivos del usuario. Hay que diseñar para minimizar esto (mixto: read auto, write/destructivo pide confirmación).

### Lo que el usuario quiere dejar fuera de V1

- **HTTP arbitrario** (APIs externas tipo Spotify, calendarios, etc.) — su propio ADR futuro.
- **MQTT / IoT / dispositivos** — su propio ADR futuro (también prerequisito del módulo `arduino-bridge`).
- **Computer-use** (mouse / teclado del SO) — depende de capacidades de Tauri overlay y permisos especiales del OS. Diferido.
- **Aprobación "remember"** (recordar permiso para una tool / sesión / día) — se valora con datos reales del MVP.

Los tres primeros son hitos enteros futuros. La aprobación "remember" es un knob de UX que se afina con uso.

## Decisión

**Shiro adquiere capacidad ejecutiva mediante un slot nuevo `tools:` en el orchestrator que registra una colección de `IToolModule`. En V1 las categorías son Filesystem (read/write/list) y Shell (allowlist de comandos). Cada herramienta declara un `permissionTier` (`auto` para read, `confirm` para write/destructivas) que el pipeline conversacional respeta — `confirm` dispara un evento `tool:requires-approval` que el cliente desktop materializa como modal de aprobación por acción. Tool-use solo en el slot cloud (Claude) en V1; el `HybridRouter` gana una dimensión que fuerza cloud cuando la query lo requiere. Tool calls se persisten en Letta como turnos especiales (rol `tool`), para que Shiro recuerde lo que ejecutó. Las decisiones de empaquetado Tauri (permisos FS, shell allowlist, dialog API, CSP, firma del auto-updater) se toman con esta visión en mente, no minimalistas. Categorías diferidas: HTTP, MQTT/IoT, computer-use.**

### 1. Slot `tools:` en el orchestrator

Sigue el patrón existente (`packages/core/src/core/orchestrator.ts`):

```ts
interface LoadedModules {
  llmLocal: ILLMModule;
  llmCloud: ILLMModule;
  router: IRouterModule;
  stt: ISTTModule;
  tts: ITTSModule;
  memory: IMemoryModule;
  avatar: IAvatarModule;
  tools: IToolsRegistry; // ← nuevo
}
```

`IToolsRegistry` agrupa `IToolModule[]`. Se instancia desde la config YAML igual que el resto de slots. Cero refactor estructural — copy-paste del patrón.

### 2. Contrato `IToolModule`

Browser-safe (vive en `packages/core/src/interfaces/`):

```ts
interface IToolModule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: ZodSchema; // valida args
  readonly permissionTier: 'auto' | 'confirm';
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
```

Implementaciones FS y Shell viven en `packages/core/src/modules/tools/` (Node-only — se exportan desde `@proyecto-shiro/core/node`, igual que `SystemTTS` y `MemoryManager`). Ver [ADR 0011](0011-core-split-browser-node.md).

### 3. Categorías V1

| Tool         | Tier      | Qué hace                                                                     |
| ------------ | --------- | ---------------------------------------------------------------------------- |
| `fs:read`    | `auto`    | Lee un archivo dentro del FS scope configurado.                              |
| `fs:list`    | `auto`    | Lista archivos / directorios dentro del scope.                               |
| `fs:write`   | `confirm` | Escribe / crea / sobrescribe un archivo. Pide confirmación con preview.      |
| `fs:delete`  | `confirm` | Borra un archivo. Pide confirmación.                                         |
| `shell:exec` | `confirm` | Ejecuta un comando del allowlist YAML con sus argumentos. Pide confirmación. |

**FS scope** se declara en `config/modules.config.yaml` (`tools.config.fs.paths: ['~/Documents/shiro-workspace', ...]`). Lecturas / escrituras fuera del scope fallan con error claro. Sin sobreescritura silenciosa.

**Shell allowlist** se declara también en YAML (`tools.config.shell.commands`). Cada entry es `{ cmd: 'git', allowed_args_pattern: '^(status|log|diff).*' }`. No hay shell completo — esto bloquea las clases enteras de error de tipo "Shiro ejecutó `rm -rf` por confusión".

**Categorías fuera de V1** documentadas explícitamente: HTTP, MQTT/IoT, computer-use. Cada una merece su ADR cuando llegue su hito.

### 4. Modelo de permisos mixto (read auto, write pide aprobación)

Los `auto` ejecutan transparentemente — Shiro lee un archivo y vuelve a hablarte sin interrupción. Los `confirm` siguen el flujo:

1. LLM emite `tool_use { name, args }`.
2. Pipeline valida con el schema, identifica `permissionTier`. Si `auto` → ejecuta y mete `tool_result` en el siguiente turno.
3. Si `confirm` → emite `tool:requires-approval { toolId, args, preview }` al bus. Pausa el pipeline.
4. Cliente muestra modal (reusa el patrón modal del avatar mute / mic): "Shiro quiere `fs:write` en `<path>` con `<preview de los primeros 200 chars>`. ¿Permitir? [Sí, una vez] [No, cancela este turno]".
5. Usuario decide. Cliente emite `tool:approval { toolId, approved: bool }`.
6. Pipeline ejecuta o cancela y devuelve el resultado al LLM.
7. LLM cierra el turno con texto natural.

**Sin "remember" en V1**. Cada acción `confirm` pide individualmente. Si la UX duele mucho con uso real, se añade "no preguntar otra vez por esta tool durante esta sesión" en un PR posterior — pero no antes de tener datos.

### 5. Tool-use solo en el slot cloud (Claude) en V1

El `HybridRouter` gana una pre-decisión: si la query menciona acción ("lee...", "ejecuta...", "muestra el archivo...", "verifica...") O si el contexto sugiere que el siguiente paso es tool_use, **fuerza cloud sin pasar por la heurística de longitud**. La detección se hace con un mini-clasificador (similar al que decide local/cloud hoy) que devuelve `{ tier, requires_tools }`.

El slot local (qwen 2.5 3b) **no recibe** la lista de tools en su system prompt. Si por error el local intenta tool_use (alucina formato), el pipeline lo trata como texto y responde "no puedo hacer eso desde local" — no se intenta ejecutar.

**Hito futuro documentado**: cuando llegue qwen3-coder + 5080 (o un modelo local con tool-use fiable), el router gana una dimensión `local.can_do_tools`. Hoy va a `false` siempre.

### 6. Persistencia en Letta como turnos especiales

Se extiende `MemoryEntry` con un `role: 'tool'` además de `user` / `assistant`:

```ts
interface ToolMemoryEntry extends MemoryEntry {
  role: 'tool';
  toolId: string;
  args: unknown;
  result: ToolResult;
  approved: boolean | null; // null si era `auto`
}
```

El `MemoryManager` los persiste con el mismo patrón WAL + drainer (ver [ADR 0017](0017-memoria-persistente-local-y-letta.md)). Shiro puede recordar contextualmente: "ayer leíste el README de mi proyecto X y dijiste que el setup estaba confuso".

Cambio cero al pipeline de embeddings — los tool turns también se embeben para `searchSemantic`.

### 7. Implicaciones para el hito Packaging Tauri

Esta sección es el **motivo de existir** de este ADR. Las decisiones Tauri deben tomarse con tools en mente:

- **`tauri.conf.json` → permisos FS**: declarar `fs:allow-read-file`, `fs:allow-read-dir`, `fs:allow-write-file`, `fs:allow-remove`. Cada uno con `scope` parametrizado (Tauri 2.0 permite scopes runtime-configurables — usar esto para que el YAML decida).
- **Permisos shell**: `shell:allow-execute` con `cmd` y `args` patterns desde el YAML. Tauri valida el allowlist en runtime; cualquier comando fuera de él falla en el bridge antes de tocar el SO.
- **Dialog plugin**: reusar `tauri-plugin-dialog` para los modales de aprobación. La fuente del modal sigue siendo el cliente React (porque el bus es WebSocket), pero si se requiere modal "OS-native" para destructivas críticas, el plugin está disponible.
- **CSP del Webview**: V1 con `default-src 'self' ws://localhost:9876` (el bus). Cuando entre HTTP-tool, abrir `connect-src` con allowlist explícita. NO usar `'unsafe-inline'` ni `'unsafe-eval'`.
- **Auto-updater**: el primer release firma con la lista de permisos **expandida prevista** (incluye fs/shell aunque el binario MVP no use tools todavía). Esto evita que al añadir tools después salga un diálogo "esta app requiere nuevos permisos" que rompe la confianza del usuario.
- **Logging de tool calls**: archivo `~/AppData/Roaming/proyecto-shiro/tool-audit.log` (NDJSON, append-only). Útil para auditoría retrospectiva.

## Alternativas consideradas

- **Tool-use con qwen 2.5 3b**: descartada. Los benchmarks públicos y pruebas internas (`docs/architecture.md` discute estabilidad) muestran que alucina argumentos en >30% de casos. La experiencia "Shiro quiso borrar archivo X que no existe" es peor que "Shiro no puede ejecutar tools".
- **Allowlist puro por tool sin diálogos**: descartada. Sería más rápido en runtime pero obliga a re-editar el YAML cada vez que aparece una nueva categoría de acción — fricción alta y opaca para el usuario. Y para tools de escritura, la falta de confirmación es un footgun real.
- **Per-action approval estricto, incluyendo reads**: descartada. "Shiro quiere leer 18 archivos para responder tu pregunta" → 18 modales = experiencia insoportable. Los reads son reversibles, baratos, y el peor caso es exposición de info que el usuario ya tiene en su disco.
- **Computer-use como tool de V1**: diferida. Requiere capacidades de overlay (Tauri 2.0 permite, pero con configuración adicional) y permisos especiales del SO (accessibility en macOS, UIAccess en Windows). Vale su propio ADR.
- **Slot único `executor` que reciba operations**: descartada. Reduce extensibilidad — registrar tools sería pasar config a un único módulo en lugar de registrar implementaciones tipadas. El patrón `IToolModule` separado permite mocking en tests y swap por categoría.
- **Tool-use exclusivamente vía el pipeline server-side, sin participación del cliente**: descartada para `confirm`. La aprobación es UX humana → el cliente debe estar en el loop. Para `auto`, el pipeline ya es server-side.

## Consecuencias

### Positivas

- **Shiro deja de ser solo VTuber**. Hace cosas reales: lee tus notas, edita un archivo a tu pedido, ejecuta un `git status` por ti. Cambio cualitativo de utilidad.
- **Infra reusada**: slot del orchestrator, EventBus, MemoryManager, character YAML. Cero piezas nuevas a nivel arquitectónico — solo nuevas implementaciones del mismo patrón.
- **Decisiones de Tauri Packaging quedan informadas**. El primer release sale con permisos previstos, no minimalistas, ahorrando re-empaquetado y firmas rotas.
- **Frontera de safety clara**. `auto` vs `confirm` es un knob simple para razonar; los modales son testables; el log de tool calls es auditable.

### Negativas / Riesgos

- **Costo de Claude por turno agentic**. Un turno con 2-3 round-trips de tool_use puede consumir 2-3x los tokens de un turno conversacional puro. Acumula con uso intensivo.
- **Complejidad del UI de aprobación**. El cliente desktop ahora tiene que manejar un estado pausado de "esperando aprobación" además de listening/thinking/speaking. Hay que diseñarlo bien para que no interrumpa la inmersión.
- **Persistencia extendida**. El schema de memoria gana un nuevo rol. Migración de datos en Letta del usuario actual (vacío hoy, pero plantar la bandera ahora).
- **Latencia adicional**. Cada modal `confirm` introduce segundos humanos en el turno. Para tools destructivas es deseable; para edge cases que se vuelvan frecuentes, irrita.
- **Sin tool-use local**: queda como deuda visible en la UX (cuando estás offline, Shiro solo conversa). Aceptable hoy, valioso de cerrar en futuro.

### Neutrales

- El cliente desktop sigue browser-safe — no toca FS ni shell directamente. Solo reacciona a eventos del bus.
- El HybridRouter gana una dimensión pero su estructura general no cambia. Sigue siendo un clasificador.
- ADR 0009 (Orbe) y ADR 0021 (Live2D) no se ven afectados — el avatar reacciona al estado conversacional, no al tool_use.

## Notas de implementación

PRs estimados para el hito agentic (post-Packaging Tauri):

1. **Slot `tools:` + `IToolModule` + `IToolsRegistry`** — refactor de `LoadedModules`, tests del registry.
2. **Tools FS** (`fs:read`, `fs:list`, `fs:write`, `fs:delete`) en `@proyecto-shiro/core/node` con FS scope desde YAML. Tests con mock de `fs`.
3. **Tool Shell** (`shell:exec`) con allowlist + validación. Tests con spawn mock.
4. **Wiring del pipeline conversacional con loop tool-use** — cambia `conversation-flow.ts` para soportar múltiples round-trips Claude ↔ tools.
5. **UI modal de aprobación** en el cliente desktop — componente + store + integración con `tool:requires-approval`.
6. **Extensión de `MemoryEntry` y persistencia** en `MemoryManager` para `role: 'tool'`. Tests del WAL + drainer con turnos tool.
7. **HybridRouter con dimensión tool-required** — clasificador previo de "requiere ejecución", forzar cloud cuando aplique.
8. **Docs cierre** (README + architecture + CLAUDE + plan) — marcar hito Agentic ✅.

Sin fechas. Status `Proposed`. La implementación entera depende de que el hito Packaging Tauri haya cerrado primero (porque sin Tauri no hay binario con permisos FS / shell).

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — modular event-driven. El slot `tools:` y el evento `tool:requires-approval` siguen el patrón.
- [ADR 0007](0007-module-loader-registry.md) — ModuleLoader factory pattern; `IToolsRegistry` se carga igual.
- [ADR 0011](0011-core-split-browser-node.md) — split browser/Node. Tools FS y Shell viven en `@proyecto-shiro/core/node`.
- [ADR 0012](0012-split-cliente-server-core-host.md) — cliente/server. Tools ejecutan server-side; el cliente solo aprueba.
- [ADR 0014](0014-llm-structured-output-text-emotion.md) — el LLM emite `text + emotion`; con tools también `tool_use`.
- [ADR 0015](0015-hybrid-router-classifier-llm-based.md) — HybridRouter. Gana una dimensión.
- [ADR 0017](0017-memoria-persistente-local-y-letta.md) — memoria. `role: 'tool'` se persiste con el mismo WAL.
- [ADR 0023](0023-shiro-self-improvement-propose-only.md) — self-improvement. **Depende de este ADR** (reusa `shell:exec` + `fs:*` + `gh` allowlisted).
- [Anthropic — Tool use](https://docs.anthropic.com/claude/docs/tool-use) — referencia del formato `tool_use` / `tool_result`.
- [Tauri 2.0 — Capabilities](https://tauri.app/v2/security/capabilities/) — permisos runtime-configurables.
