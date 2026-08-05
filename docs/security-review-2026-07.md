# Revisión de seguridad y calidad — Proyecto Shiro

**Fecha:** 2026-07-15
**Autor:** Claude (Fable 5), revisión asistida
**Alcance:** `core` + `core-host` (TS), `desktop` + Tauri (Rust), `services/whisper` (Python), dependencias + config + CI.
**Modelo de amenaza:** local, un solo usuario, sin exposición de red _intencional_. Cada hallazgo se califica con esa base y se etiqueta:

- 🟢 **local** — riesgo real solo si otro proceso/persona ya tiene tu máquina o tu red.
- 🔴 **red** — la severidad sube si Shiro pasa a multi-device / se expone a la red (previsto en la arquitectura: móvil, Arduino, IoT).

> **Nota metodológica:** no se ejecutó ningún exploit. Los escenarios se siguen leyendo el código; las líneas citadas son reales. `npm audit` se corrió con acceso a red (solo consulta de avisos, sin subir código).

---

## Resumen ejecutivo

Shiro tiene una **postura de seguridad deliberada y por encima de lo habitual** para un proyecto de 2 personas: spawn sin shell, allowlists, denylist de inmutables hardcodeada, gate de aprobación con timeout, cota de vueltas del tool-loop, `randomUUID` para las URLs de audio, CSP sin `unsafe-eval`, y chat que renderiza texto plano (sin sinks de HTML). Eso se nota y conviene mantenerlo.

Los hallazgos se concentran en **dos frentes**:

1. **Superficie de red sin autenticar y bindeada a todas las interfaces** (core-host WS/HTTP y Whisper). Hoy es "solo local" por convención, pero el bind es `0.0.0.0` y **no se valida `Origin`**, así que el riesgo es mayor de lo que sugiere "local": cualquier web que visites —o cualquier host de tu LAN— puede hablarle al bus.
2. **Salvaguardas del hito agéntico/self-dev con fugas de borde**: la denylist de inmutables se puede sortear por mayúsculas en Windows, `fs:write` sigue symlinks preexistentes, y el matching del allowlist de shell tiene aristas para cuando amplíes la lista.

Más una tanda de **cadena de suministro / CI**: clave de firma del updater sin passphrase, Actions sin pin por SHA, y dependencias con CVEs (2 críticas dev, 2 altas que pueden llegar a producción).

### Tabla de hallazgos

| ID     | Severidad (local → red)       | Área        | Título                                                             |
| ------ | ----------------------------- | ----------- | ------------------------------------------------------------------ |
| SEC-01 | 🟠 Media → 🔴 Alta            | Red         | WS `/bus` + audio HTTP en `0.0.0.0`, sin auth ni check de `Origin` |
| SEC-02 | 🟠 Media → 🔴 Alta            | Red         | Whisper STT sin auth, `0.0.0.0`, buffer de audio sin tope (DoS)    |
| SEC-03 | 🟠 Media                      | Self-dev    | Denylist de inmutables sorteable por mayúsculas en Windows         |
| SEC-04 | 🟡 Baja                       | Tools FS    | `fs:write` sigue symlinks preexistentes en el destino              |
| SEC-05 | 🟡 Baja (footgun)             | Tools shell | Allowlist matchea args unidos por espacio y sin anclar             |
| SEC-06 | 🟠 Media                      | Secretos    | El logger no redacta secretos (fuga vía objetos de error)          |
| SEC-07 | 🟡 Baja                       | Secretos    | `mode: 0o600` de `secrets.env` es no-op en Windows                 |
| SEC-08 | 🟡 Baja                       | Datos       | Memoria (SQLite/Letta) en claro; args de tools se persisten        |
| SEC-09 | 🟠 Media (estructural)        | Tauri       | `fs`/`shell`/`dialog` registrados; la ACL es la única barrera      |
| SEC-10 | 🔵 Info                       | Tauri       | CSP y render del chat — postura buena (a mantener)                 |
| SEC-11 | 🟠 Media                      | CI/updater  | Clave de firma del updater sin passphrase; Actions sin pin SHA     |
| SEC-12 | 🟠 Media (dev) → parcial prod | Deps        | `npm audit`: 2 críticas (vitest), 2 altas (form-data, undici)      |
| SEC-13 | 🟡 Baja                       | Docker      | Contenedor Whisper corre como root; imágenes sin pinar             |

Bugs / calidad no-seguridad: **BUG-01..03** al final.

---

## Hallazgos

### SEC-01 — WS `/bus` + ruta de audio: `0.0.0.0`, sin auth, sin verificación de `Origin`

**Severidad:** 🟠 Media (local) → 🔴 Alta (red) · **Área:** core-host / red

**Ubicación:**

- [`packages/core-host/src/transports/websocket-server-transport.ts:98`](packages/core-host/src/transports/websocket-server-transport.ts) — `this.httpServer.listen(options.port)` sin argumento `host` → Node bindea a **todas** las interfaces (`::` / `0.0.0.0`).
- No hay validación de `Origin` en el upgrade (`handleConnection`, línea 230).
- [`packages/core-host/src/audio/audio-route.ts:47,55`](packages/core-host/src/audio/audio-route.ts) — `Access-Control-Allow-Origin: *`.
- Handlers sin auth: `secrets:save` ([`bootstrap.ts:254`](packages/core-host/src/bootstrap.ts)), `tool:approval` ([`approval-gate.ts:45`](packages/core-host/src/pipeline/approval-gate.ts)).

**Escenario.** El core-host acepta cualquier WebSocket a `ws://<tu-ip>:9876/bus` sin credencial y sin comprobar de dónde viene. Como los WebSocket **no** están sujetos a same-origin para conectar, **cualquier página web que abras** mientras Shiro corre puede hacer `new WebSocket('ws://localhost:9876/bus')` y, una vez dentro:

- emitir `user:message` → conducir al LLM (y, en tier cloud, disparar las tools `auto` `fs:read`/`fs:list` sobre `~/shiro-workspace`);
- observar el `tool:requires-approval` (se hace **broadcast a todos los clientes**) y responder `tool:approval {approved:true}` con el mismo `requestId` → **auto-aprobar** un `fs:write`/`fs:delete`/`shell:exec`;
- mandar `secrets:save` con valores vacíos → **borrar** tus API keys (DoS) o pisarlas;
- leer el audio TTS (`GET /audio/<id>` con CORS `*`).

En LAN (café, coworking, red de casa compartida) el mismo ataque lo hace cualquier host. El gate de aprobación **no** protege aquí: hereda la confianza del WS, y el `requestId` viaja en claro a todos los clientes.

**Remediación.**

1. Bindear a `127.0.0.1` por defecto (`listen(port, '127.0.0.1')`), con opt-in explícito por env var para exponer a red.
2. Validar `Origin` en el evento `upgrade` (allowlist del cliente Tauri / `tauri://localhost` / `http://localhost:5173`).
3. Antes de multi-device: handshake con token compartido (el mismo patrón que `LETTA_SERVER_PASSWORD`), y que el `tool:approval` valide que viene del cliente que "posee" la sesión.
4. La ruta de audio: acotar CORS al origin del cliente en vez de `*`.

_Deuda si sale a red:_ esto pasa a ser el hallazgo #1 a resolver **antes** de conectar cualquier cliente que no sea el desktop local.

---

### SEC-02 — Whisper STT: sin auth, `0.0.0.0`, buffer de audio sin tope

**Severidad:** 🟠 Media (local) → 🔴 Alta (red) · **Área:** services/whisper

**Ubicación:**

- [`services/whisper/config.py:67`](services/whisper/config.py) — `host` default `0.0.0.0`.
- [`services/whisper/main.py:75-80`](services/whisper/main.py) — CORS `allow_origins=["*"]`.
- [`services/whisper/main.py:137,150`](services/whisper/main.py) — `buffer = bytearray()` que crece con cada chunk **sin límite**; cada partial re-transcribe el buffer entero (coste O(n²) en CPU/GPU conforme crece).
- [`docker-compose.yml:71`](docker-compose.yml) — `'8765:8765'` publica en `0.0.0.0` del host.

**Escenario.** El WS `/stt` acepta binario ilimitado. Un cliente (web local o host de LAN — los WS no validan CORS al conectar) puede enviar audio indefinidamente hasta agotar RAM, o mantener un buffer grande que dispara re-transcripciones caras y satura la GPU/CPU. Sin auth, es un DoS trivial contra el micro y, por extensión, contra el resto del sistema que comparte esa GPU. Coincide con la deuda ya anotada (`whisper-stt-security-deferred`).

**Remediación.**

1. Tope de bytes del buffer + rechazo de frames sobredimensionados (cerrar con code 1009 "Message Too Big").
2. Bindear a `127.0.0.1` y publicar `127.0.0.1:8765:8765` en compose.
3. Ventana deslizante en vez de re-transcribir todo el buffer (mejora de coste, ya insinuada en los comentarios).

---

### SEC-03 — La denylist de inmutables de self-dev se sortea por mayúsculas en Windows

**Severidad:** 🟠 Media · **Área:** self-dev (salvaguarda estructural)

**Ubicación:**

- [`packages/core/src/modules/tools/selfdev/immutable-paths.ts:37,52`](packages/core/src/modules/tools/selfdev/immutable-paths.ts) — comparación **case-sensitive**: `IMMUTABLE_FILES = new Set(['CLAUDE.md', '.gitignore'])`, prefijos literales `'config/'`, `'docs/adr/'`, `'packages/core/src/character/'`, `'safety/'`.
- Aplicada por [`selfdev-tools.ts:127`](packages/core/src/modules/tools/selfdev/selfdev-tools.ts) (`SelfDevWriteGuard`), en tier **`auto`** (sin modal).

**Escenario.** El filesystem de Windows (donde desarrollas — ver perfil) es **case-insensitive**. `isImmutable('Config/modules.config.yaml')` → normaliza a `Config/…`, que **no** empieza por `config/` (minúscula) → devuelve `false` → el guard deja pasar la escritura, y `fs.writeFile` aterriza en el `config/` real. Lo mismo con `CLAUDE.MD`, `Docs/adr/0001-….md`, `Packages/Core/Src/Character/default.yaml`, `.ENV`. Como en self-dev las escrituras van sin modal, Shiro podría —vía un topic malicioso o una alucinación— modificar su propio carácter, un ADR, la config de permisos o `.env` dentro del worktree, y meterlo en un PR. La denylist es, según el ADR 0023, una **frontera estructural**, no un diálogo; esta fuga la degrada a "estructural salvo que uses mayúsculas".

**Remediación.**

1. Normalizar a minúsculas **ambos lados** de la comparación (o al menos en `win32`) en `isImmutable`/`normalize`.
2. De paso, cubrir `secrets.env` y los `.env` anidados (hoy solo se protege `.env`/`​.env.*` en la raíz): `packages/*/​.env` no matchea.
3. Test de regresión con variantes de caso.

---

### SEC-04 — `fs:write` sigue un symlink preexistente en la ruta destino

**Severidad:** 🟡 Baja (local) · **Área:** tools FS

**Ubicación:**

- [`packages/core/src/modules/tools/fs/fs-scope.ts:118-141`](packages/core/src/modules/tools/fs/fs-scope.ts) — en creación (`mustExist=false`) se hace `realpath` solo del **directorio padre existente**, no del componente final; devuelve `abs` (no el realpath del target).
- [`packages/core/src/modules/tools/fs/fs-tools.ts:141-142`](packages/core/src/modules/tools/fs/fs-tools.ts) — `fs.writeFile(r.abs, …)` sigue symlinks.

**Escenario.** El anti-symlink del `FsScope` corta el caso "un directorio intermedio es un symlink a fuera del scope". Pero si el **archivo destino ya existe como symlink** dentro del scope apuntando fuera (p.ej. `~/shiro-workspace/notas.txt` → `C:\Windows\…\algo`), el padre resuelve dentro del scope (OK) y `writeFile` **sigue** el symlink, escribiendo fuera del sandbox. Requiere que alguien haya plantado el symlink antes; en el modelo local es bajo, pero es un hueco real en una defensa que el código presenta como completa.

**Remediación.** Antes de escribir, `lstat` del target: si es symlink, rechazar (o `fs.rm` + crear archivo nuevo), o abrir con un flag que no siga enlaces. Validar el realpath del propio target cuando ya existe.

---

### SEC-05 — Allowlist de shell: match sobre args unidos por espacio y sin anclar (footgun)

**Severidad:** 🟡 Baja hoy (footgun para el futuro) · **Área:** tools shell

**Ubicación:**

- [`packages/core/src/modules/tools/shell/shell-tool.ts:87-96`](packages/core/src/modules/tools/shell/shell-tool.ts) — `ShellAllowlist.check` hace `pattern.test(argsStr)` con `argsStr = cmdArgs.join(' ')`.

**Escenario / por qué importa.** Hoy **no es explotable**: el shell del usuario por defecto es solo git de lectura ([`modules.config.yaml:180`](config/modules.config.yaml)), el push de self-dev está bien anclado (`shiro/[A-Za-z0-9._-]+$`), y en self-dev los args los fija el orquestador, no el LLM. Pero el diseño tiene dos aristas que muerden cuando **amplíes** el allowlist:

1. **Args unidos por espacio**: la regex razona sobre tokens separados por espacio, pero los argv reales van separados. Un argumento que contenga un espacio desincroniza lo que valida la regex de lo que se ejecuta.
2. **Sin anclar al final**: un patrón como `'^push origin shiro/'` (sin `$`) matchearía `push origin shiro/x --force …`. El `$` del ejemplo actual es lo que lo salva; nada en el código lo obliga.

**Remediación.** Validar **por argumento** (array) en vez del string unido; y/o documentar/forzar que los patrones estén anclados (`^…$`). Añadir un test que ejercite un arg con espacios.

---

### SEC-06 — El logger no redacta secretos

**Severidad:** 🟠 Media · **Área:** secretos / observabilidad

**Ubicación:** [`packages/core/src/core/logger.ts:123`](packages/core/src/core/logger.ts) — `safeStringify` es `JSON.stringify` pelado; sin lista de claves sensibles.

**Escenario.** Muchos sitios loguean objetos de error: `logger.error('…', { err })` en el transport, el pipeline, los módulos LLM/TTS, etc. Los errores del SDK de Anthropic/ElevenLabs y de `undici` a veces incluyen detalles del request (URL, a veces cabeceras). Con `LOG_LEVEL=debug` se serializa aún más. Una API key o un `Authorization: Bearer …` podría acabar en stdout / archivo de log (el sidecar drena stdout/stderr al log de Tauri, [`lib.rs:163-167`](packages/desktop/src-tauri/src/lib.rs), que persiste a disco). Nota: el código **propio** es cuidadoso (nunca loguea el valor de las keys; `loadSecretsEnv` devuelve solo nombres), así que el riesgo es indirecto vía objetos de terceros.

**Remediación.** Un serializador con redacción en el logger: enmascarar `MANAGED_KEYS`, y cualquier valor que matchee `sk-…`/`Bearer …`/`api[_-]?key`. Barato y cubre toda la superficie de una.

---

### SEC-07 — `mode: 0o600` de `secrets.env` es no-op en Windows

**Severidad:** 🟡 Baja · **Área:** secretos

**Ubicación:** [`packages/core-host/src/secrets/secrets-file.ts:105`](packages/core-host/src/secrets/secrets-file.ts) — `writeFileSync(path, after, { mode: 0o600 })`.

**Escenario.** En Windows los bits de modo POSIX no se traducen a ACL de NTFS; el `0o600` no restringe nada. El archivo hereda la ACL del `app_local_data_dir` (perfil de usuario), que **normalmente** ya es user-only, así que en la práctica está bien — pero el `0o600` da una falsa sensación de blindaje y no es la defensa que aparenta.

**Remediación.** En `win32`, fijar la ACL explícita (p.ej. `icacls` a solo el usuario) o documentar que la protección real es la ACL heredada del data dir. En POSIX el `0o600` sí aplica; mantenerlo.

---

### SEC-08 — Memoria en claro; args de tools persistidos

**Severidad:** 🟡 Baja (local) · **Área:** datos en reposo

**Ubicación:** [`local-memory.ts`](packages/core/src/modules/memory/local-memory.ts) (SQLite WAL, `data/memory.db`), Letta; turnos `role:'tool'` con `metadata.args`/`result` en [`tool-loop.ts:77-85`](packages/core-host/src/pipeline/tool-loop.ts).

**Escenario.** Toda la conversación y las acciones (incl. `args` de `fs:write` con un `preview` del contenido, y salidas de shell) se guardan sin cifrar. En local es aceptable, pero: (a) `data/memory.db` hereda permisos del cwd; (b) si alguna vez pasa por ahí algo sensible (una key que el usuario pegó en el chat, un archivo con secretos leído por `fs:read`), queda en claro y se sincroniza a Letta. `.gitignore` ya cubre `data/`/`*.db` (bien).

**Remediación.** Documentar el modelo de datos-en-reposo; considerar redactar args sensibles en los turnos `tool`; revisar permisos del `.db` en Windows. No urgente en local.

---

### SEC-09 — Tauri: `fs`/`shell`/`dialog` registrados; la ACL de capabilities es la única barrera

**Severidad:** 🟠 Media (estructural) · **Área:** desktop/Tauri

**Ubicación:**

- [`packages/desktop/src-tauri/src/lib.rs:58-60`](packages/desktop/src-tauri/src/lib.rs) — `.plugin(tauri_plugin_fs::init())`, `shell`, `dialog` registrados.
- [`packages/desktop/src-tauri/capabilities/default.json`](packages/desktop/src-tauri/capabilities/default.json) — no concede ninguno de sus permisos (esa ausencia es lo único que los deniega).

**Escenario.** El equipo lo documenta bien: en Tauri 2 cada plugin expone sus comandos IPC al webview, y sin permiso en la capability la ACL los rechaza. El riesgo es la **fragilidad**: una sola línea de más (`"shell:allow-execute"`, `"fs:allow-write-file"`) volvería esos comandos invocables desde **cualquier** código del webview. Combinado con SEC-01 (una web puede hablarle al bus, no al IPC de Tauri directamente — pero el día que el hito agentic los active, la superficie crece), conviene un candado explícito.

**Remediación.**

1. Test/CI que **falle** si `capabilities/default.json` concede cualquier permiso de `fs:`/`shell:`/`dialog:` no esperado (snapshot del set permitido).
2. Cuando llegue el hito agentic en el webview, conceder permisos con **scope** mínimo y no `allow-execute` genérico.
3. Evaluar si `dialog` hace falta hoy (no se usa en `lib.rs`); si no, no registrarlo reduce superficie. (`shell` sí lo necesita el mecanismo de sidecar.)

---

### SEC-10 — CSP y render del chat: postura buena (a mantener)

**Severidad:** 🔵 Info · **Área:** desktop/Tauri

**Observación (positivo).** La CSP ([`tauri.conf.json:31`](packages/desktop/src-tauri/tauri.conf.json)) es razonable: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (sin `unsafe-eval` ni `unsafe-inline` para scripts), `connect-src` acotado a `localhost`/`ipc`. El único aflojado es `style-src 'unsafe-inline'` (común, bajo riesgo). El chat **no** usa `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni un renderer de markdown (grep limpio en `packages/desktop/src`) — los mensajes del LLM se pintan como texto plano, que React escapa. Buena defensa contra XSS del texto que genera el modelo.

**Recomendación.** Mantenerlo. Si algún día añades render de markdown al chat, sanitiza (p.ej. `rehype-sanitize`) — sería el punto donde el texto del LLM podría inyectar HTML.

---

### SEC-11 — Clave de firma del updater sin passphrase; Actions sin pin por SHA

**Severidad:** 🟠 Media · **Área:** CI / auto-updater (cadena de suministro)

**Ubicación:**

- [`.github/workflows/release.yml:70`](.github/workflows/release.yml) — `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''` (passphrase vacía, documentada).
- Actions por tag, no por SHA: `tauri-apps/tauri-action@v0`, `dtolnay/rust-toolchain@stable`, `swatinem/rust-cache@v2`, `actions/*@v4`.
- `permissions: contents: write` a nivel workflow.

**Escenario.** La clave ed25519 que firma las actualizaciones no tiene segundo factor: quien obtenga el archivo de la clave (un secret de GitHub, o una Action comprometida con acceso al entorno) puede **forjar** un `latest.json` + payload firmado, y el auto-updater lo instala. Es el camino de mayor impacto de todo el repo: una actualización forjada = ejecución de código en la máquina que actualiza. Que las Actions estén por tag móvil (`@v0`, `@stable`) agranda la ventana: si una de esas Actions se compromete, corre en el job que tiene acceso a `TAURI_SIGNING_PRIVATE_KEY`. Hoy el "parque" es tu propia máquina, así que el blast radius es 1 — pero es deuda que crece sola en cuanto distribuyas el binario.

**Remediación.**

1. Regenerar la clave **con** passphrase; guardarla como secret aparte.
2. Pinear las Actions por commit SHA (al menos las de terceros: `tauri-action`, `rust-toolchain`, `rust-cache`).
3. Bajar `contents: write` al job que lo necesita.
4. (Opcional) firmar también el binario con un cert real cuando toque distribuir.

---

### SEC-12 — Dependencias con CVEs (`npm audit`)

**Severidad:** 🟠 Media (dev) → parcialmente producción · **Área:** deps

**Resultado (`npm audit`, 2026-07-15):** 10 vulnerabilidades — **2 críticas, 3 altas, 4 moderadas, 1 baja**. Las relevantes:

| Paquete               | Sev               | Aviso                                                                                                                         | ¿Alcance?                                        |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `vitest` `<3.2.6`     | **Crítica** (9.8) | UI server: lectura/ejecución de archivo arbitrario ([GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)) | Dev/test (solo si corres la UI de vitest)        |
| `@vitest/coverage-v8` | Crítica           | vía `vitest`                                                                                                                  | Dev/test                                         |
| `form-data` `<4.0.6`  | **Alta** (7.5)    | CRLF injection en multipart ([GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx))                        | Transitiva (SDKs HTTP) — **puede llegar a prod** |
| `undici` `7.x <7.28`  | **Alta**          | bypass de validación TLS vía SOCKS5 ProxyAgent                                                                                | Transitiva — **puede llegar a prod**             |
| `vite` `<=6.4.2`      | Alta              | `server.fs.deny` bypass en Windows; path traversal                                                                            | Dev server                                       |
| `esbuild` `<=0.24.2`  | Moderada          | dev server acepta requests de cualquier web                                                                                   | Dev server                                       |
| `js-yaml` `4.0-4.1.1` | Moderada          | DoS cuadrático por merge keys                                                                                                 | Parseo de YAML (config local, confiable)         |
| `@yao-pkg/pkg`        | Baja              | vía `esbuild`                                                                                                                 | Build del sidecar                                |

**Escenario.** La mayoría es tooling de desarrollo (vitest/vite/esbuild/pkg) — impacto real bajo salvo que expongas el dev server o la UI de vitest. Las dos que importan para producción son **transitivas de los SDKs HTTP** (`form-data`, `undici`): revisá por dónde entran (`npm ls form-data undici`) y si el binario empaquetado las incluye.

**Remediación.** `npm audit fix`; bump de `vitest`/`vite` (semver-major, requiere probar); confirmar resolución de `form-data`/`undici`. **Añadir escaneo a CI**: hoy [`ci.yml`](.github/workflows/ci.yml) no corre `npm audit` ni CodeQL ni tiene dependabot.

---

### SEC-13 — Contenedor Whisper como root; imágenes sin pinar

**Severidad:** 🟡 Baja · **Área:** Docker

**Ubicación:** [`services/whisper/Dockerfile`](services/whisper/Dockerfile) — sin `USER`, corre como root; [`docker-compose.yml:26`](docker-compose.yml) — `letta:latest` (el propio compose ya tiene un TODO para pinar).

**Remediación.** Añadir un usuario no-root al Dockerfile; pinar `letta` y la base CUDA a un digest. Bajo, contenedor local.

---

## Bugs y calidad (no-seguridad)

- **BUG-01 — `Mutex::lock().unwrap()` en el sidecar.** [`lib.rs:156,189`](packages/desktop/src-tauri/src/lib.rs): si un hilo paniquea sosteniendo el lock, el `unwrap()` sobre un mutex envenenado paniquea la app al matar el sidecar. Usar `lock().unwrap_or_else(|e| e.into_inner())` o manejar el poison. Robustez, no seguridad.

- **BUG-02 — El modal de aprobación trunca los args a 200 chars.** [`tool-loop.ts:47`](packages/core-host/src/pipeline/tool-loop.ts) (`previewArgs`): para `fs:write`/`shell:exec` el humano aprueba **sin ver** el contenido/args completos. Gap de UX-seguridad: estás autorizando algo que no ves entero. Considerá mostrar el contenido completo (o un resumen mejor) para tier `confirm`.

- **BUG-03 — `.env` anidados no protegidos por la denylist.** Ver SEC-03: solo `.env`/`.env.*` en la raíz del repo se marcan inmutables; `packages/*/​.env` o `secrets.env` no. Cerralo junto con SEC-03.

---

## Lo que está bien (mantener)

- **Spawn sin shell** (`shell:false`) salvo `.cmd`/`.bat` en Windows, con razón documentada (CVE-2024-27980). Cero inyección de shell por defecto.
- **Self-dev con fronteras duras**: push anclado a `shiro/…$`, `gh` hardcodeado a `pr create`, denylist de inmutables en código (no en YAML), worktree aislado, PR con doble gate (sesión + PR).
- **Cotas y timeouts**: tool-loop cotado (`max_tool_rounds: 5`), gate de aprobación con timeout, lecturas de memoria con deadline individual.
- **URLs de audio con `randomUUID`** (no enumerables) + TTL.
- **Letta con `SECURE=true` + password**; `.gitignore` cubre `secrets.env`, `data/`, `*.db`, claves de firma.
- **CSP sin `unsafe-eval`** + chat sin sinks de HTML.
- **API keys nunca logueadas** por el código propio; `loadSecretsEnv` devuelve nombres, no valores.

---

## Backlog priorizado

**Arreglar pronto (baratos y de alto valor, incluso en local):**

1. SEC-03 — normalizar mayúsculas en la denylist de inmutables (+ BUG-03). _Salvaguarda de self-dev en tu propia plataforma._
2. SEC-01 (parcial) — bindear core-host a `127.0.0.1` + validar `Origin`. _Corta el vector "web que visitas"._
3. SEC-02 (parcial) — tope de buffer en Whisper + bind `127.0.0.1`.
4. SEC-06 — redacción de secretos en el logger.
5. SEC-11 — pinar Actions por SHA + regenerar clave con passphrase.
6. SEC-12 — `npm audit fix` + añadir `npm audit` a CI.

**Deuda aceptable hoy (local), revisar antes de multi-device/red:**

- SEC-01/-02 completos (auth por token), SEC-04, SEC-05, SEC-07, SEC-08, SEC-09, SEC-13.
- Estas quedan candidatas a un **ADR** que declare formalmente el modelo de confianza local y el trigger de revisión (ver abajo).

## Seguimiento propuesto (ADR)

Varios hallazgos (SEC-01, SEC-02, y en parte SEC-08/-09) no son "bugs" sino una **decisión de modelo de confianza**: _"mientras el despliegue sea local y de un solo usuario, aceptamos WS/STT sin autenticar"_. Eso merece un ADR que lo deje explícito con su **trigger de reversión** (el primer cliente que no sea el desktop local en la misma máquina). Se propone `docs/adr/0025-modelo-de-confianza-local-y-superficie-de-red.md` (borrador aparte, en estado `Proposed` hasta que lo revises).
