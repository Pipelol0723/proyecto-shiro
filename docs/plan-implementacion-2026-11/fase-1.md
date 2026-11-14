# Plan de implementación (2026-11) — Fase 1: encargos

> Parte del [plan de implementación](README.md) (estado: Fase 1 aprobada el 2026-11-13 y en ejecución; respuestas del dueño en §2.0 del índice). Los IDs R-xxx, L-xxx y P-xx son los de la [revisión](../revision-estado-2026-11.md) y del [plan de mejora](../plan-mejora-2026-11.md). Las referencias a otras secciones (§1, §2, §7 en el índice; §3 a §6 en los archivos hermanos) están resueltas en la tabla del [índice](README.md).

## 3. Fase 1 — encargos

Ítems P-01, P-02, P-04, P-05, P-06a, P-06b, P-07a, P-07b, P-08 y el resto de P-03 (script de AGENTS.md, plantilla de encargo y limpieza de ramas). P-03a (docs sincronizadas con el ADR 0029) lo hace otro grupo de agentes y no se detalla aquí. Cada encargo está pensado para que un agente lo ejecute sin volver a decidir.

### 3.1 Olas: orden único de la Fase 1

Una sola tabla para toda la Fase 1. En cada ola hay como mucho 2 PRs de agente abiertos; la ola siguiente empieza cuando se fusionan los de la anterior (o cuando uno se fusiona y el siguiente de la tabla no depende del otro).

| Ola  | PR A                                     | PR B                                               | Requisito para empezar                                          | Tareas manuales (las hace el agente, salvo «Pipe»)                             |
| ---- | ---------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | P-01 · self-dev apagado (hecho, PR #102) | P-02 PR1 · timeouts de shell-tool (hecho, PR #101) | nada                                                            | Ramas remotas muertas: ya borradas (2026-11-13); quedan las locales fusionadas |
| 2    | P-02 PR2 · logger                        | P-08 · modal seguro                                | nada                                                            | Capturas del modal en los 3 temas                                              |
| 3    | P-02 PR3a · script `verify`              | P-04 PR1 · zod, form-data y shell-quote            | nada                                                            | —                                                                              |
| 4    | P-04 PR2 · CI                            | P-05 PR1 · bind en loopback                        | P-02 PR3a y P-04 PR1 fusionados                                 | Ajustes de GitHub tras P-04 PR2; `netstat` del bus                             |
| 5    | P-05 PR2 · Origin y `approved`           | P-06a · compose                                    | P-05 PR1 fusionado; Docker arrancado y digest de Letta          | Pruebas de Origin y del binario (compilado en local); prueba del compose       |
| 6    | P-06b · Whisper                          | P-07b · AudioProvider                              | P-06a y P-04 PR2 fusionados                                     | Digest de la base CUDA; reconstruir Whisper                                    |
| 7    | P-07a PR1 · `onStateChange` (core)       | P-02 PR3b · docs de `verify`                       | PR3b: P-03a fusionado (si aún no, la ola sigue con un solo PR)  | —                                                                              |
| 8    | P-07a PR2 · conexión visible             | P-03 PR1 · `sync-agents-md.mjs`                    | P-07a PR1 y P-07b; para P-03 PR1, P-03a, el ADR 0029 y P-04 PR2 | Prueba de conexión; revisar AGENTS.md regenerado                               |
| 9    | P-03 PR2 · plantilla en CONTRIBUTING     | PR de la voz nueva (§5.8)                          | P-03a fusionado                                                 | Pipe: 10 min con la voz nueva                                                  |
| cola | P-03 PR3 · `.gitignore` acotado          | —                                                  | respuesta sobre `.claude/`                                      | —                                                                              |

Choques de archivos que la tabla evita:

- P-05 PR1 y PR2 tocan `websocket-server-transport.ts` (del **servidor**); P-07a toca el transport del **cliente** (`packages/core/src/core/transports/websocket-transport.ts`). No chocan.
- P-04 PR2 y P-06b tocan `.github/workflows/ci.yml`: P-06b va después.
- P-06a y P-06b tocan `docker-compose.yml`: P-06b va después.
- P-07b y P-07a PR2 tocan `App.tsx` y `ConversationScreen.tsx`: P-07a PR2 va después.
- P-08 toca `ToolApprovalModal`; P-07a **no** lo toca (deshabilitar sus botones sin conexión, R-282, es un PR de 10 líneas después de P-08).
- P-02 PR3b, P-03 y el PR de la voz tocan README.md o CLAUDE.md: todos esperan a P-03a.

### 3.2 Reglas comunes a todos los encargos

- Rama `feat/pipe/<tarea>` desde `develop`, PR a `develop`, prefijo de commit de CLAUDE.md. Diff ≤ 300 líneas de código y tests (aquí no se cuentan el lockfile ni el texto de los ADR; criterio de este plan, a confirmar con el ADR 0029); si un PR se pasa, se parte como dice su encargo.
- **Test rojo primero:** el commit con los tests nuevos falla por la razón correcta; el arreglo lo pone en verde. Donde el rojo no se puede ver en CI (P-06b), se demuestra en local y se pega la salida en el PR.
- `npm run verify` antes de pedir revisión.
- Las pruebas manuales con I/O real (red, memoria, binario, modal, log) las hace el agente antes de fusionar; a Pipe solo se le piden las que necesitan su oído o su voz. El agente fusiona cuando el CI está en verde y un segundo agente ha revisado el diff (§2.0, A2 y A3).
- Nadie toca README.md, CLAUDE.md, AGENTS.md ni el ADR 0029 mientras P-03a esté abierto; lo que haga falta cambiar ahí está en §3.14.
- Las enmiendas de ADR viajan en el mismo PR que el código que las motiva.

### 3.3 Lo que el código dice distinto de lo que supone el plan

Dos tablas: la A (filas D1-D18) para red y fronteras, la B (filas B1-B12) para calidad, CI y cliente. Los encargos las citan por su fila.

#### Tabla A — red y fronteras

| #   | Supuesto del plan / revisión                                                                                                 | Realidad en el código                                                                                                                                                                                                                            | Consecuencia para el encargo                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | «Si falta el bloque `selfdev`, self-dev está apagado» (lo dice el comentario de `packages/core/src/config/schemas.ts:64-69`) | `parseSelfDevConfig(undefined)` aplica defaults (`selfdev-tools.ts:77-78`) y `wireSelfDev` lo habilita; el test `wire-selfdev.test.ts:34,64` lo demuestra (sin bloque → `enabled: true`)                                                         | P-01 debe meter `enabled` en `SelfDevConfigSchema` con default `false`, no solo en el YAML, y corregir el comentario                                  |
| D2  | «`wireSelfDev` sale antes de `detectEnv` si es false»                                                                        | Hoy el orden es detectar entorno (`wire-selfdev.ts:316-321`, lanza `git` y `gh`) → LLM (`:324-328`) → parsear config (`:330-336`)                                                                                                                | P-01 reordena: parsear config primero                                                                                                                 |
| D3  | El test de P-01 puede vivir en el bootstrap                                                                                  | `bootstrap.ts:338` salta self-dev entero en modo test (`simulationSpeed === 0`)                                                                                                                                                                  | El test va en `wire-selfdev.test.ts` y en un test que carga el YAML real                                                                              |
| D4  | `--on-accent` «oscuro en cyber, blanco en kawaii/editorial» (ficha R-286)                                                    | Blanco sobre `#ec4899` (kawaii) da **3,53:1**, por debajo de 4,5:1. Cyber blanco/`#00ffe1` = 1,28:1. Editorial blanco/`#1a1a1a` = 17,4:1 (cálculo WCAG propio, 2026-11-12)                                                                       | Kawaii necesita texto oscuro (`#2a1530` = 4,77:1): decidido por Pipe (§2.0, B1)                                                                       |
| D5  | ADR 0027 §4: allowlist `tauri://localhost`                                                                                   | En Windows Tauri 2 sirve el frontend en `http://<scheme>.localhost` salvo `useHttpsScheme` (docs oficiales de Tauri 2, consultadas el 2026-11-12); `tauri.conf.json` no activa `useHttpsScheme`                                                  | Allowlist: `http://tauri.localhost`, `http://localhost:5173`, `http://127.0.0.1:5173`                                                                 |
| D6  | ADR 0027, notas: `packages/core-host/src/tools/approval-gate.ts`                                                             | Está en `packages/core-host/src/pipeline/approval-gate.ts`                                                                                                                                                                                       | Se corrige en la enmienda                                                                                                                             |
| D7  | ADR 0027 §4: sin `Origin` solo se acepta con token válido                                                                    | En 2a no hay token. Si se exige token, los tests de Node y cualquier cliente no navegador se cortan                                                                                                                                              | La enmienda dice: en 2a la ausencia de `Origin` se acepta (bind loopback); desde 2b (P-40) exige token                                                |
| D8  | «`approved:"false"` no aprueba» como bug                                                                                     | Confirmado: `approval-gate.ts:50` hace `entry.resolve(p.approved)` sin validar; el payload llega como `unknown` (`wire-schema.ts:27`) y `tool-loop.ts:121` y `selfdev-session.ts:289` usan `if (!approved)`, así que la cadena `"false"` aprueba | El test rojo es real                                                                                                                                  |
| D9  | La base CUDA por digest va en P-06a                                                                                          | La base vive en `services/whisper/Dockerfile:9`, archivo que reescribe P-06b                                                                                                                                                                     | Se mueve a P-06b; P-06a toca solo `docker-compose.yml`                                                                                                |
| D10 | «Whisper sin root» es un cambio de una línea                                                                                 | El volumen `whisper_models` está montado en `/root/.cache/huggingface` (`docker-compose.yml:108`) y sus archivos son de root                                                                                                                     | P-06b usa un volumen nuevo y otra ruta de caché; el modelo se vuelve a descargar una vez                                                              |
| D11 | «Origin y CORS acotados» en Whisper                                                                                          | El CORS de FastAPI no se aplica a WebSocket; `/stt` hace `ws.accept()` sin mirar nada (`main.py:128-130`)                                                                                                                                        | Hace falta comprobar `Origin` a mano en `/stt` antes de `accept()`                                                                                    |
| D12 | Tope en `/transcribe` comprobando el tamaño                                                                                  | `Body(...)` (`main.py:98-99`) lee el cuerpo entero en RAM antes de que el handler pueda mirar nada                                                                                                                                               | Leer con `Request.stream()` y cortar al pasar el tope (413)                                                                                           |
| D13 | Probar el binario real en WebView2 «en el mismo PR»                                                                          | Construir el binario exige Rust. Rust 1.96 ya está instalado en el portátil, con las herramientas de C++ y WebView2, pero no en el PATH del usuario                                                                                              | El binario se compila en local para la prueba de P-05 (§2.0, B6)                                                                                      |
| D14 | El gate pide `Test-NetConnection` desde otro equipo de la red                                                                | Ese equipo puede estar apagado o desconectado                                                                                                                                                                                                    | El test automático de «IP no-loopback rechazada» (P-05) cubre el gate; la prueba desde otro equipo queda como comprobación opcional                   |
| D15 | Los clientes pueden pasar a `127.0.0.1`                                                                                      | La CSP de `tauri.conf.json:31` solo permite `ws://localhost:*` y `http://localhost:*`                                                                                                                                                            | No cambiar las URLs de los clientes a `127.0.0.1` en esta fase                                                                                        |
| D16 | Arreglar las referencias 0025 → 0027 en los docs vivos (L-DOC-01)                                                            | README.md:598, CLAUDE.md:17 y AGENTS.md:16,85 los está editando P-03a ahora                                                                                                                                                                      | P-05 solo enmienda ADR 0027 (y la cabecera de 0025 si hace falta); el resto va en §3.14                                                               |
| D17 | Comprobar que el bus no responde en la IP de la LAN                                                                          | `listen(port)` sin host escucha en `::` con doble pila (docs de Node 22, consultadas el 2026-11-12), así que hoy el puerto 9876 responde en todas las interfaces, IPv4 incluida                                                                  | Confirma R-002/R-003                                                                                                                                  |
| D18 | `npm run dev` y los tests usan `ws://localhost`                                                                              | Con bind a `127.0.0.1`, `localhost` puede resolver primero a `::1`. Node 22 tiene `autoSelectFamily: true` por defecto desde la v20 (docs de Node) y reintenta por IPv4. Chromium/WebView2 también reintenta                                     | Los tests nuevos usan `127.0.0.1` explícito. Los de siempre deberían seguir pasando; si alguno falla en Windows, se cambia a `127.0.0.1` (solo tests) |

#### Tabla B — calidad, CI y cliente

| #   | El plan supone                                                                              | El código dice                                                                                                                                                                                                                                                                                                                                | Consecuencia para los encargos                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | La única excepción del audit es **form-data** y caduca con el SDK de Anthropic 1.x (P-31a). | form-data entra en producción por `@anthropic-ai/sdk` 0.39.0 → `@types/node-fetch` 2.6.13, que pide `form-data: ^4.0.4` (`package-lock.json:2708`). El aviso GHSA-hmw2-7cc7-3qxx está parcheado en **4.0.6**, que cabe en `^4.0.4`, y 4.0.6 es la `latest` del registro (consulta del 2026-11-12). El resumen de audit ya decía `fix: true`.  | **No hace falta excepción.** P-04 PR1 sube form-data a 4.0.6 sin tocar el SDK. El archivo de excepciones arranca **vacío** y el mecanismo se prueba con fixtures.                                      |
| B2  | zod es la única vulnerabilidad de producción.                                               | En producción hay tres: zod 4.4.3 (high), form-data 4.0.5 (high) y qs 6.15.2 (moderate, vía `@pixi/utils` → `url`). Comprobado con los flags `dev` del lock.                                                                                                                                                                                  | Con umbral `high`, qs no bloquea. Queda anotado para dependabot.                                                                                                                                       |
| B3  | El test rojo de shell-tool es uno.                                                          | Fallan **dos** tests de forma alterna con el timeout de 5 s de Vitest: «falla si el comando no existe en PATH» (`shell-tool.test.ts:114`, 3,8 s en la corrida de hoy) y «spawnea un .cmd/.bat…» (`:126`, 5,02 s). El `30_000` de la línea 132 es el timeout **de la tool**, no el del test.                                                   | P-02 PR1 da timeout a los dos.                                                                                                                                                                         |
| B4  | Gate F1: «0 tests omitidos sin motivo anotado».                                             | El único omitido es `ollama-llm-live.test.ts:31` con `it.skipIf(!ENABLED)` y su motivo ya está anotado en las líneas 1-15 (opt-in con `OLLAMA_INTEGRATION=1`).                                                                                                                                                                                | El gate se cumple sin tocarlo. No hay que forzarlo.                                                                                                                                                    |
| B5  | `send()` rechaza y así el cliente se entera.                                                | `EventBus.emit` captura el rechazo de cada transport y solo lo loguea (`event-bus.ts:60-66`). Además despacha en local **antes** de saber si salió (`:59`), así que `user:message` entra al historial aunque se pierda.                                                                                                                       | Que `send()` rechace documenta el contrato, pero **la UI tiene que mirar el estado**, no la promesa. P-07a deshabilita el envío sin conexión.                                                          |
| B6  | `onStateChange` es un cambio aditivo «declarado en architecture.md».                        | ADR 0013 dice que, con la conexión caída, el mensaje «se pierde» sin más (`docs/adr/0013-protocolo-websocket-eventbus.md:123`). El desktop no tiene acceso al transport: `main.tsx:27-32` lo crea y solo pasa el bus a `<App>`, y `BusProvider` no expone los transports (`bus-context.tsx:31-43`).                                           | P-07a PR1 lleva una **enmienda de ADR 0013** (regla única del plan: en el mismo PR). P-07a PR2 añade un `ConnectionProvider` alimentado desde `main.tsx`.                                              |
| B7  | Los scripts de raíz (`scripts/*.mjs`) se pueden añadir sin más.                             | `eslint .` aplica `recommendedTypeChecked` a todo lo que no esté ignorado. Ya hubo que ignorar `packages/desktop/scripts/*.mjs` por eso (`eslint.config.js:40-43`). No existe la carpeta `scripts/` en la raíz.                                                                                                                               | P-04 y P-03 añaden `'scripts/**/*.mjs'` a los ignores de ESLint y llevan `// @ts-check`.                                                                                                               |
| B8  | Los tests de scripts corren con `node --test`.                                              | En Node 22, `node --test` sin argumentos busca también `**/*.test.ts` (strip-types activo por defecto según la doc de Node 22) y recorrería los tests de Vitest de los paquetes.                                                                                                                                                              | Se llama siempre con glob explícito: `node --test "scripts/**/*.test.mjs"`.                                                                                                                            |
| B9  | P-02 actualiza README y CLAUDE.md para citar `verify`.                                      | Ese bloque (`README.md:121-125`, CLAUDE.md «Antes de pushear») lo están reescribiendo ahora otros agentes, y AGENTS.md pasará a ser generado.                                                                                                                                                                                                 | P-02 se parte: **PR3a** añade solo el script (sin documentos, sin esperar); **PR3b** cambia ese bloque **después** de P-03a. Si los otros agentes ya escriben `npm run verify`, PR3b no hace falta.    |
| B10 | El check obligatorio es «el de CI».                                                         | El job se llama `Typecheck, lint, test, build` (`ci.yml:16`). Un required check se ata a ese nombre: si se renombra después, `develop` queda bloqueado.                                                                                                                                                                                       | P-04 PR2 lo renombra a `verify` **antes** de marcarlo como required.                                                                                                                                   |
| B11 | Subir el audio a un provider basta.                                                         | Con Live2D activo, `useLipSync` crea un `AudioContext` por montaje y no lo cierra (`useLipSync.ts:113-130`), y `createMediaElementSource` solo puede llamarse una vez por elemento (`:83-100`, captura el error y devuelve `null`). Volver al chat con un audio sonando deja ese audio sin lip-sync, y cada visita acumula un `AudioContext`. | Fuera de alcance (Live2D aparcado). Se anota como riesgo de P-07b y como prueba manual si Pipe tiene los assets de Live2D.                                                                             |
| B12 | Limpieza de ramas: 5 ramas.                                                                 | Hay 9 ramas remotas además de `origin/main` y `origin/develop` (la de esta revisión incluida) y **71 locales**. El `develop` local está desfasado frente a `origin/develop` (no incluye PR #97/#98) y hay 8 worktrees que retienen ramas.                                                                                                     | P-03b separa remoto (6 ramas, cada una con su R-xxx; las remotas muertas ya se borraron el 2026-11-13) y local (`git branch -d`, solo fusionadas, contra `origin/develop`, saltando las de worktrees). |

### 3.4 P-02 — Suite verde, logger que serializa `Error` y `npm run verify`

- **Objetivo.** Que `npm test` pase siempre en Windows, que los logs muestren el motivo de cada error y que haya un solo comando previo al push idéntico al CI.
- **Qué cierra.** L-TEST-01 (R-192), L-BUG-01 (R-057) y L-DOC-02 (R-245, R-243, R-264 en su parte de pre-push, R-267).
- **PRs (4):**
  1. `test: timeout explícito en los tests de shell-tool que lanzan procesos`
  2. `fix: el logger serializa Error con message, stack y cause`
  3. PR3a `chore: añade npm run verify como único paso previo al push` (solo `package.json`)
  4. PR3b `docs: cita npm run verify en README y CLAUDE.md` (después de P-03a; se omite si P-03a ya lo dejó así)
- **Estado (2026-11-13).** **Hecho.** PR1 en el PR #101, PR2 (logger) en el PR #104, y PR3a y PR3b juntos en el PR #106 (`verify` y su cita en los documentos, sin esperar a P-03a: AGENTS.md se editó a mano).

**Archivos a tocar**

| PR  | Archivo                                                                   | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/core/tests/unit/modules/tools/shell/shell-tool.test.ts`         | Constante `SPAWN_TEST_TIMEOUT_MS = 30_000` arriba del `describe('ShellExecTool')` (`:68`) y pasada como tercer argumento de `it` en los tests de las líneas 114 y 126. En el de la 114, `vi.stubEnv('PATH', tmpdir())` para que `resolveCommand` no recorra todo el PATH (`vi.unstubAllEnvs()` en `afterEach`). No se toca `packages/core/vitest.config.ts`: un `testTimeout` global escondería tests lentos de verdad.                                                                                                                                                                         |
| 2   | `packages/core/src/core/logger.ts:123-129`                                | `safeStringify` pasa un _replacer_ a `JSON.stringify`. Nueva función interna `serializeError(err, depth, seen)` que devuelve `{ name, message, stack, cause?, ...propias }`: `stack` recortado a 10 líneas (`MAX_STACK_LINES`), `cause` recursiva hasta profundidad 3 (`MAX_CAUSE_DEPTH`), guardia de ciclos con `WeakSet`, y de las propiedades propias enumerables (`code`, `status`, `errno`, `syscall`…) **solo las primitivas**, para no volcar objetos grandes como cabeceras HTTP. `AggregateError.errors` se serializa como lista. Sin APIs de Node (el logger es universal, ADR 0011). |
| 2   | `packages/core/src/core/logger.ts:117-121`                                | `formatValue` usa el mismo `safeStringify`, así que un `Error` en el **contexto** de `child()` también se serializa. Sin cambio de firma.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | `packages/core/tests/unit/core/logger.test.ts`                            | Nuevo `describe('errores')` (ver test rojo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3a  | `package.json:13-24`                                                      | Script `"verify": "npm run build -w @proyecto-shiro/core && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build"`. `&&` funciona en npm sobre cmd.exe y sh. P-04 PR2 le añadirá `test:scripts`.                                                                                                                                                                                                                                                                                                                                                              |
| 3b  | `README.md:121-125`, CLAUDE.md «Antes de pushear» y su copia en AGENTS.md | Sustituir la lista de 5 comandos por `npm run verify` y una línea con lo que hace. Si AGENTS.md ya es generado (P-03), se edita CLAUDE.md y se regenera. Corregir de paso `npm test -w @proyecto-shiro/core` (R-267), que no existe: el equivalente es `npx vitest run --project core`.                                                                                                                                                                                                                                                                                                         |

**Test rojo primero**

- PR1: el rojo ya existe. Antes de cambiar nada, el agente pega en el PR la salida de `npx vitest run --project core tests/unit/modules/tools/shell` con el `Test timed out in 5000ms` (si en su máquina no falla, lo provoca con `vitest --testTimeout=1000` y lo dice).
- PR2, en `packages/core/tests/unit/core/logger.test.ts`, `describe('errores')`:
  - `serializa un Error con name, message y stack` → la línea contiene `"message":"detalle"`, `"name":"Error"` y `"stack":"Error: detalle`.
  - `serializa la cadena cause de un Error anidado` → `new Error('fuera', { cause: new Error('dentro') })` produce los dos mensajes, el de dentro bajo `"cause"`.
  - `conserva name y propiedades primitivas de un error propio` → una clase `OllamaLLMError` con `code = 'ECONNREFUSED'` muestra `"name":"OllamaLLMError"` y `"code":"ECONNREFUSED"` (hoy la corrida de tests imprime solo `{"err":{"name":"OllamaLLMError"}}`).
  - `no entra en bucle con una cause circular` → `a.cause = b; b.cause = a` no lanza y la línea contiene `[circular]`.
  - `recorta el stack a MAX_STACK_LINES líneas`.
  - `serializa un Error puesto en el contexto de child()`.
  - Los cuatro primeros fallan hoy porque la salida es `{"err":{}}`.
- PR3a y PR3b: no hay test unitario; la verificación es ejecutar `npm run verify` y que salga 0 (ver criterio).

**Pasos**

1. PR1: añadir la constante y los timeouts; `stubEnv` en el test de PATH; ejecutar `npm test` dos veces seguidas en Windows.
2. PR2: escribir los tests, verlos fallar, implementar `serializeError` y el replacer, y pasar `npm test`.
3. PR3a: añadir `verify` y ejecutar `npm run verify` desde un clon limpio con `dist/` borrado (`Remove-Item -Recurse packages/core/dist`) para probar que compila core primero (R-245).
4. PR3b (cuando P-03a esté fusionado): cambiar el bloque de docs; si AGENTS.md ya es generado, editar CLAUDE.md y regenerar.

**Criterio de hecho**

- `npm test` dos veces seguidas en Windows: `Tests 0 failed | 637 passed | 1 skipped` (o más tests que pasan). El omitido es `ollama-llm-live`.
- En la salida de `npm test`, las líneas `ERROR … {"err":…}` de `conversation-flow.test.ts` y `websocket-server-transport.test.ts` llevan ahora `message` y `stack` en vez de `{}`.
- `npm run verify` con `packages/core/dist` borrado → código de salida 0.
- `git grep -n "npm test -w"` en README.md no devuelve nada.

**Prueba manual.** No hace falta. Opcional: Pipe arranca el core-host con Ollama parado, manda un mensaje y comprueba que el log dice `ECONNREFUSED` (o el motivo real) en lugar de `{}`.

**Tamaño y quién.** PR1 ≈ 15 líneas, agente (haiku o sonnet), 0,5 h. PR2 ≈ 120 líneas, agente (sonnet), 0,75 h. PR3a ≈ 5 líneas y PR3b ≈ 15 líneas, agente (haiku), 0,75 h entre los dos (incluye coordinar con los documentos). **Total 2 h.**

**Riesgos y reversión.**

- Los `stack` hacen más largas las líneas de error. Por eso el recorte a 10 líneas. Se revierte el PR2 sin tocar nada más.
- Una propiedad propia de un error podría contener un secreto (p. ej. una URL con key). Por eso solo se copian primitivas. El agente revisor mira en el diff la lista de props copiadas.
- `verify` tarda lo que suman los 5 pasos (≈ 1-2 min en el portátil). Si molesta, no se recorta: es el precio de no romper el CI.

**Depende de:** nada (PR1, PR2 y PR3a); PR3b depende de P-03a. **Desbloquea:** P-04 PR2 (CI usa `verify`, gracias a PR3a), el gate 1 de F1 y la regla «`verify` verde» de ADR 0029.

### 3.5 P-01 — Apagar self-dev por defecto hasta el gate de F3

- **Objetivo.** Que self-dev no se registre (ni la tool `selfdev:propose`) salvo que alguien ponga `selfdev.enabled: true` a mano. Es contención mientras F3 lo arregla de verdad.
- **Qué cierra.** Contiene R-001, R-017 y R-018 (no los arregla: el arreglo es P-23 y P-25a). Cumple el punto 4 del gate de F1.
- **PRs.** 1: `chore: desactiva self-dev por defecto hasta aislar el eval`. Sin ADR: es reversible en minutos y el ADR 0023 ya prevé un modo apagado («dev-only»). Se añade solo la nota en la revisión de seguridad.
- **Estado (2026-11-13).** **Hecho**: PR #102, fusionado el 13-nov.

**Archivos a tocar**

| Archivo:línea                                                    | Cambio                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/modules/tools/selfdev/selfdev-tools.ts:44-65` | Nuevo campo `enabled: z.boolean().default(false)` con comentario en español (apagado hasta el gate de F3, ver plan P-01/P-29)                                                                                                                                    |
| `packages/core/src/config/schemas.ts:64-69`                      | Corregir el comentario: «si falta el bloque o `enabled` no es `true`, self-dev está apagado». El tipo sigue siendo `record` (el schema sigue browser-safe)                                                                                                       |
| `packages/core-host/src/selfdev/wire-selfdev.ts:311-336`         | Mover `parseSelfDevConfig(config.selfdev)` al principio. Si `!sdConfig.enabled` → `log.info('self-dev desactivado por config (selfdev.enabled=false)')` y `return noop` **antes** de `detect(log)`. Después siguen detectEnv y la comprobación del LLM, como hoy |
| `config/modules.config.yaml:193-200`                             | `enabled: false` como primera clave del bloque `selfdev:`, con comentario: «Apagado hasta el gate de F3 (P-29). Ponerlo a true solo a mano y sabiendo que el eval corre con tus credenciales (R-017)». Ajustar el comentario de la línea 197-198                 |
| `docs/security-review-2026-07.md` (tras la tabla, línea ~46)     | Nota corta fechada: «Self-dev apagado por defecto desde P-01. Se reactiva en P-29, al pasar el gate de F3 (push tras la aprobación, `.github/` inmutable, eval con env filtrado)»                                                                                |

Nota: `config/` es inmutable para self-dev (`immutable-paths.ts`), así que Shiro no puede volver a encenderse a sí misma.

**Test rojo primero**

| Archivo                                                                        | Caso                                                                                                                                                   | Qué comprueba                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core-host/tests/unit/selfdev/wire-selfdev.test.ts`                   | `deshabilitado por defecto: sin selfdev.enabled no llama a detectEnv ni registra el trigger`                                                           | Con `config: {}` y `detectEnv = vi.fn()`, `enabled === false`, `detectEnv` no se llama y `registry.get('selfdev:propose')` es `undefined`. Hoy falla (sale `true`)                                                                                                                                            |
| ídem                                                                           | `deshabilitado con selfdev.enabled=false explícito`                                                                                                    | Igual, con `config: { selfdev: { enabled: false } }`                                                                                                                                                                                                                                                          |
| ídem, `baseOpts` (`wire-selfdev.test.ts:34`)                                   | El default pasa de `config: {}` a `config: { selfdev: { enabled: true } }`. Solo los dos casos nuevos de «deshabilitado» pasan `{}` o `enabled: false` | Sin esto, los casos existentes «deshabilitado si el entorno no es apto» (`:44`) y «deshabilitado si el LLM cloud no soporta tool-use» (`:55`) pasarían por la razón equivocada (salen por `enabled=false` sin ejercitar `detectEnv` ni la comprobación del LLM). Con `enabled: true` siguen probando su causa |
| ídem (caso existente de la línea 64)                                           | Hereda `enabled: true` de `baseOpts`                                                                                                                   | Sigue registrando `selfdev:propose` con tier `confirm`                                                                                                                                                                                                                                                        |
| `packages/core/tests/unit/modules/tools/selfdev/selfdev-tools.test.ts:31-40`   | Añadir `expect(c.enabled).toBe(false)` en el caso de defaults                                                                                          | El default del schema                                                                                                                                                                                                                                                                                         |
| `packages/core-host/tests/unit/selfdev/selfdev-default-config.test.ts` (nuevo) | `config/modules.config.yaml del repo trae selfdev.enabled=false`                                                                                       | Carga el YAML real con `ConfigLoader` (ruta relativa al test, `../../../../../config/modules.config.yaml`) y comprueba que `parseSelfDevConfig(config.selfdev).enabled === false`                                                                                                                             |

**Pasos**

1. Rama `feat/pipe/p01-selfdev-off` desde `develop`.
2. Escribir los tests de la tabla. `npm run build -w @proyecto-shiro/core` y `npm test`: deben fallar los nuevos (commit `test: self-dev apagado por defecto (rojo)` dentro del PR).
3. Campo `enabled` en el schema, reordenar `wireSelfDev`, YAML y comentarios.
4. Nota en la revisión de seguridad.
5. `npm run verify` (si P-02 aún no está, la secuencia de checks de CLAUDE.md).

**Criterio de hecho**

- `npm test -w @proyecto-shiro/core-host -- wire-selfdev selfdev-default-config` → todos verdes. Los nuevos estaban rojos en el commit anterior.
- `git grep -n "enabled: false" config/modules.config.yaml` devuelve la línea del bloque `selfdev`.
- Prueba manual (Pipe, 2 min): `npm run dev`, en el log del core-host aparece `self-dev desactivado por config` y no aparece `self-dev habilitado`.

**Tamaño, quién y horas.** ~80 líneas · mixto (agente escribe; Pipe aprueba y mira el log) · 1,5 h.

**Riesgos y reversión.** Riesgo bajo: si Pipe quiere usar self-dev antes de F3, lo enciende a mano en el YAML (sin commitear). Reversión: revertir el commit. Sin migraciones.

**Depende de:** nada. **Desbloquea:** P-23/P-25a/P-29 (F3) sin tener R-001 abierto mientras tanto; el gate 4 de F1.

### 3.6 P-08 — Modal de aprobación seguro por defecto y legible

- **Objetivo.** Que un Space o Enter por reflejo nunca apruebe una tool `confirm`, y que «Permitir una vez» se lea en los 3 temas.
- **Qué cierra.** L-SEG-05 (R-030) y la parte de contraste de L-PROD-06 (R-286, solo el botón y sus dos gemelos; `--ink-faint` va en P-42).
- **PRs.** 1: `fix: foco en Cancelar y contraste legible en el modal`.

**Archivos a tocar**

| Archivo:línea                                                                                                               | Cambio                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/components/ToolApproval/ToolApprovalModal.tsx:54-72`                                                  | `autoFocus` pasa de «Permitir una vez» (`:66`) a «Cancelar». Orden visual igual                                                                                                                                                                                                                                                                |
| ídem `:21-30`                                                                                                               | Guardar `openedAt` al aparecer `pending`. Listener `keydown` en fase de captura: si la tecla es `' '` o `'Enter'` y han pasado menos de 500 ms desde que se abrió → `preventDefault()` y `stopPropagation()`. `Escape` sigue cancelando. Comentario de cabecera: «Esc cancela; foco inicial en Cancelar; Space/Enter ignorados 500 ms (R-030)» |
| `packages/desktop/src/themes/cyber.css:24`                                                                                  | `--on-accent: #07070d;` (15,7:1 sobre `#00ffe1`)                                                                                                                                                                                                                                                                                               |
| `packages/desktop/src/themes/kawaii.css:25`                                                                                 | `--on-accent: #2a1530;` (4,77:1 sobre `#ec4899`): texto oscuro, decidido por Pipe (§2.0, B1)                                                                                                                                                                                                                                                   |
| `packages/desktop/src/themes/editorial.css:22`                                                                              | `--on-accent: #ffffff;` (17,4:1 sobre `#1a1a1a`)                                                                                                                                                                                                                                                                                               |
| `ToolApprovalModal.module.css:95`                                                                                           | `color: var(--on-accent);`                                                                                                                                                                                                                                                                                                                     |
| `packages/desktop/src/screens/Setup/SetupScreen.module.css:190` y `packages/desktop/src/updater/UpdateBanner.module.css:49` | Mismo cambio: el mismo `color: white` sobre `--accent` (botones «Guardar» de las API keys y «Actualizar y reiniciar»). Son 2 líneas y entran en este PR (§2.0, B1)                                                                                                                                                                             |

**Test rojo primero**

| Archivo                                                   | Caso                                                              | Qué comprueba                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/tests/components/ToolApproval.test.tsx` | `el foco inicial está en Cancelar`                                | Tras emitir `tool:requires-approval`, `document.activeElement` es el botón «Cancelar». Hoy es «Permitir una vez»                                                                                                                                     |
| ídem                                                      | `Space al abrir no emite approved:true`                           | Con `userEvent.setup()` (ya es dependencia, `packages/desktop/package.json:36`), `await user.keyboard(' ')` justo después de abrir; ninguna aprobación con `approved: true`. Hoy aprueba (user-event simula la activación nativa del botón enfocado) |
| ídem                                                      | `Enter al abrir no emite approved:true`                           | Igual con `{Enter}`                                                                                                                                                                                                                                  |
| ídem                                                      | `tras 500 ms, Tab hasta Permitir y Enter sí aprueba`              | Con temporizadores falsos, avanzar 600 ms, `user.tab()` y `{Enter}` → `approved: true` (no se rompe el uso con teclado)                                                                                                                              |
| `packages/desktop/tests/themes/contrast.test.ts` (nuevo)  | `--on-accent sobre --accent ≥ 4,5:1 en kawaii, cyber y editorial` | Lee los 3 CSS con `fs`, saca `--accent` y `--on-accent` con una regex y calcula el contraste WCAG 2.x (luminancia relativa). Hoy falla porque `--on-accent` no existe                                                                                |
| ídem                                                      | `ninguna hoja usa color: white sobre --accent`                    | Recorre los 3 `.module.css` citados y falla si un bloque con `background: var(--accent)` lleva `color: white`                                                                                                                                        |

**Pasos**

1. Rama `feat/pipe/p08-modal-seguro`. Tests rojos.
2. Cambios de TSX y CSS.
3. `npm run verify`.
4. El agente: `npm run dev`, provocar una tool `confirm` (por ejemplo, pedir a Shiro que escriba un archivo en `~/shiro-workspace`), comprobar que Space al aparecer el modal no aprueba, y capturar el modal en los 3 temas.

**Criterio de hecho.** Tests nuevos verdes (rojos antes) y `verify` verde. Las 3 capturas van en el PR y el agente revisor comprueba que el texto del botón se lee a simple vista.

**Tamaño, quién y horas.** ≈ 120 líneas (≈ 30 de código y CSS, ≈ 90 de tests) · agente · 1 h (revisión y capturas).

**Riesgos y reversión.** El guard de 500 ms podría tragarse un Enter legítimo muy rápido: es intencionado. En jsdom la activación por teclado la simula user-event; en WebView2 la confirma la prueba manual. Reversión: revertir el commit.

**Depende de:** nada. **Desbloquea:** P-27 (preview de aprobación) y P-42 (resto de L-PROD-06).

### 3.7 P-04 — CI que vigila: permisos, dependabot, audit de producción y zod

- **Estado (2026-11-13).** **Hecho.** PR1 en el PR #107 y PR2 en el PR #108. Diferencias con lo escrito abajo: no hay paso de CI aparte para `test:scripts` (ya va dentro de `verify`), `npm audit` se lanza con `shell: true` en todas las plataformas, el script acepta `--exceptions <archivo>`, rechaza excepciones con claves desconocidas o con más de 180 días de plazo, y los tests son 17. El check `verify` es obligatorio en `develop` y las alertas de Dependabot están activas. Las actualizaciones de seguridad automáticas (_Dependabot security updates_) quedan apagadas hasta P-44: hoy abrirían de golpe hasta 10 PRs sobre dependencias de desarrollo que ese lote ya sube.
- **Fuente única.** Este encargo es la única definición de P-04 (PR1 mínimo y PR2 de CI) y del `dependabot.yml`. El resto de subidas dentro de rango es el lote V1 de §4, que va **después** de P-04 PR1.
- **Objetivo.** Que una vulnerabilidad de producción high o crítica ponga el CI en rojo, que el token del CI no tenga más permisos que leer, que las dependencias se propongan solas en lotes pequeños y que `develop` no acepte un PR en rojo.
- **Qué cierra.** L-TOOL-01 (R-209, R-220) y L-SEG-06 (R-019, R-011, R-012, R-055).
- **PRs (2) y una acción en GitHub:**
  1. `fix: sube zod y form-data a versiones parcheadas y corrige el override de shell-quote`
  2. `ci: permisos mínimos, dependabot y audit de producción`
  3. El agente marca el check `verify` como _required_ en `develop` (Settings → Branches o Rulesets).

**Archivos a tocar**

| PR  | Archivo                                  | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/core/package.json:29`          | `"zod": "^4.6.7"` (el aviso cubre `<4.6.6`; 4.6.7 es la `latest` el 2026-11-12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1   | `package.json:36-38`                     | Override `"shell-quote": "^1.11.0"` (hoy `^1.8.4` deja el lock en 1.8.4, vulnerable; la `latest` es 1.12.0). Es de desarrollo (vía `concurrently`), pero el override actual da una falsa sensación de mitigación (R-012).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1   | `package-lock.json`                      | Solo zod, form-data (4.0.5 → 4.0.6, `:5334`) y shell-quote (`:7171`). Se hace con `npm install zod@^4.6.7 -w @proyecto-shiro/core` y `npm update form-data`. **Nada de `npm audit fix` general**: el resto de subidas va por los lotes de versiones que se están planificando aparte.                                                                                                                                                                                                                                                                                                                                                                                              |
| 2   | `.github/workflows/ci.yml`               | (a) `permissions: contents: read` a nivel de workflow, tras `concurrency` (`:10-12`). (b) Job renombrado: `name: verify` (`:16`). (c) Los pasos de `:37-53` se sustituyen por `npm run verify` (un solo sitio de verdad con lo que corre Pipe en local). (d) Paso nuevo `npm run test:scripts`. (e) Paso nuevo `node scripts/audit-prod.mjs`, sin `continue-on-error` ni `\|\| true`. `timeout-minutes` sube de 10 a 15 por el audit.                                                                                                                                                                                                                                              |
| 2   | `scripts/audit-prod.mjs` (nuevo)         | Exporta `evaluateAudit(report, exceptions, today)` → `{ ok, failures[], expired[] }`. Umbral: `high` y `critical`. Una excepción tapa por nombre de paquete (y por id de aviso si lo trae). Una excepción **caducada falla** aunque el aviso ya no exista. La CLI ejecuta `npm audit --omit=dev --json` con `spawnSync` (`shell: process.platform === 'win32'`, porque en Windows `npm` es `npm.cmd`), lee `stdout` sea cual sea el código de salida (npm devuelve ≠ 0 cuando hay avisos) y sale con 0 (ok), 1 (avisos o excepción caducada) o 2 (salida que no es JSON, p. ej. sin red). Opción `--input <archivo>` para probar sin red. Imprime una tabla corta. `// @ts-check`. |
| 2   | `scripts/audit-exceptions.json` (nuevo)  | `[]`. Esquema de cada entrada: `{ "package", "advisory", "reason", "expires": "AAAA-MM-DD", "item": "P-xx" }`. Ver tabla B, fila B1: form-data no necesita excepción.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2   | `scripts/audit-prod.test.mjs` (nuevo)    | Tests con `node:test` y `node:assert` (ver test rojo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2   | `scripts/fixtures/audit-*.json` (nuevos) | Recortes de una salida **real** de `npm audit --omit=dev --json`, capturada por el agente **antes** de fusionar PR1 (para tener un caso con zod y form-data). El formato (`vulnerabilities` por paquete, con `severity`, `isDirect`, `via` y `fixAvailable`) se deduce de esa salida: no lo he comprobado en la documentación de npm.                                                                                                                                                                                                                                                                                                                                              |
| 2   | `package.json:13-24`                     | `"test:scripts": "node --test \"scripts/**/*.test.mjs\""` (glob explícito, ver tabla B, fila B8) y `verify` termina en `&& npm run test:scripts`. `"audit:prod": "node scripts/audit-prod.mjs"` para uso local (fuera de `verify`, porque necesita red).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | `eslint.config.js:40-43`                 | Añadir `'scripts/**/*.mjs'` a `ignores`, con el mismo comentario que ya justifica `packages/desktop/scripts/*.mjs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | `.github/dependabot.yml` (nuevo)         | Ver abajo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2   | `docs/security-review-2026-07.md`        | Fila SEC-12 de la tabla viva (la crea P-03a): pasa a «mitigado: audit de producción en CI desde <fecha>». Si la tabla aún no existe, una línea en el PR y se añade cuando exista.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

`dependabot.yml` aprobado tal cual (§2.0, B4; sintaxis de la referencia oficial, consultada el 2026-11-12; el límite por defecto es 5 PRs por ecosistema, aquí se baja):

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 2
    cooldown: { default-days: 7 }
    ignore:
      # Las majors van por los lotes de versiones planificados, con tests.
      - dependency-name: '*'
        update-types: ['version-update:semver-major']
    groups:
      npm-produccion:
        dependency-type: production
        update-types: [minor, patch]
      npm-desarrollo:
        dependency-type: development
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 1
    groups:
      actions: { patterns: ['*'] }
  - package-ecosystem: cargo
    directory: /packages/desktop/src-tauri
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 1
    ignore:
      - dependency-name: '*'
        update-types: ['version-update:semver-major']
    groups:
      tauri: { patterns: ['tauri*'] }
  - package-ecosystem: pip
    directory: /services/whisper
    schedule: { interval: monthly }
    open-pull-requests-limit: 1
```

Como mucho 5 PRs de dependabot abiertos, que es justo la señal de replanificar de §10 del plan. **Fuera a propósito:** `docker` y `docker-compose` (Letta se fija por digest en P-06a y sus subidas exigen backup previo); se añaden cuando Pipe lo decida. Mantener alineados `@tauri-apps/*` (npm) y los crates `tauri*` (cargo) en un solo PR exige un grupo multi-ecosistema (`multi-ecosystem-group`, que la referencia menciona); no lo he probado, así que queda **sin verificar** y fuera de este PR. Que el `ignore` de majors también afecte a las _security updates_ de Dependabot: **sin verificar**.

Este archivo es el **único** `dependabot.yml`. Cuando existan los lotes correspondientes de §4 se amplía en ese mismo archivo, no en otro: grupo `vitest-vite` (vite, vitest, `@vitest/*`, `@vitejs/*`) cuando se haga V2c; grupo `tauri` multi-ecosistema (`@tauri-apps/*` + crates `tauri*`) cuando se pruebe con V4; `pip` ya está y `docker` entra con P-18; y, si Pipe levanta el `ignore` general de majors, se sustituye por la lista concreta de ignorados de §4.6.

**Test rojo primero** (`scripts/audit-prod.test.mjs`, rojo porque el módulo no existe; después, rojo por la razón correcta al implementar cada regla):

- `pasa con un informe sin vulnerabilidades`
- `falla con una vulnerabilidad high de producción sin excepción` (fixture con zod 4.4.3)
- `falla con una critical`
- `ignora moderate y low` (fixture con qs)
- `una excepción vigente tapa su paquete`
- `una excepción caducada falla aunque el aviso siga`
- `una excepción caducada falla aunque el aviso ya no exista`
- `devuelve código 2 si la salida no es JSON` (la CLI con `--input` a un archivo de texto)
- `today` se inyecta: ningún test depende de la fecha real.

PR1 no lleva test nuevo: su verificación es que los tests de `wire-schema` y de configs (los que usan zod) siguen en verde y que el audit de producción queda limpio.

**Pasos**

1. Antes de PR1: el agente captura `npm audit --omit=dev --json` a `scripts/fixtures/` (recortado a zod, form-data y qs).
2. PR1: subir zod, form-data y el override; `npm run verify`; `npm audit --omit=dev` sin high ni critical. Regenerar el sidecar no hace falta en el PR (no hay release hasta F3).
3. PR2: script, tests, fixtures, `package.json`, ESLint, dependabot y `ci.yml`, en ese orden. Comprobar en el PR que el job `verify` corre y sale verde.
4. El agente, tras fusionar PR2: (a) Settings → Code security: activar _Dependabot alerts_ y _Dependabot security updates_ si no lo están; (b) regla de rama para `develop` con el check `verify` obligatorio y PR obligatorio (§2.0, A3).

**Criterio de hecho**

- `npm audit --omit=dev --audit-level=high` sale con 0.
- `npm run test:scripts` → 8 tests en verde. `node scripts/audit-prod.mjs` → código 0 y tabla vacía.
- Con `scripts/audit-exceptions.json` modificado a mano con una entrada caducada → código 1 (prueba local, no se commitea).
- En GitHub: el job se llama `verify`, el workflow muestra `permissions: contents: read`, dependabot abre su primera tanda el lunes siguiente con ≤ 5 PRs, y un PR de prueba con un test roto no se puede fusionar en `develop`.
- `git grep -n "|| true" .github/` no devuelve nada.

**Prueba manual (el agente).** Abrir un PR borrador que rompa un test a propósito y comprobar que el botón de merge queda bloqueado. Cerrarlo sin fusionar.

**Tamaño y quién.** PR1 ≈ 30 líneas más el lock, agente (haiku), 0,5 h. PR2 ≈ 250 líneas, mixto (sonnet escribe; ecosistemas y límites ya decididos), 1,5 h. Ajustes de GitHub: agente, 0,25 h. **Total 2,25 h.**

**Riesgos y reversión.**

- `npm audit` depende del registro: una caída hace fallar el CI con código 2. Es lo correcto (no se aprueba a ciegas); si pasa a menudo, se relanza el job. No se añade `|| true`.
- Un aviso nuevo de producción pone `develop` en rojo de un día para otro. Es el objetivo; la salida es subir el paquete o añadir una excepción **con fecha** y el ítem que la cierra.
- Un PR de dependabot rompe algo sutil. El check obligatorio lo frena; si pasa, se revierte el PR de dependabot.
- Reversión: PR2 se revierte entero; la regla de rama se quita en Settings.

**Depende de:** P-02 PR3a (`verify`) para PR2. **Desbloquea:** el gate 1 de F1 (CI verde con audit y check obligatorio), el límite de «2 PRs de agente» con red de seguridad automática, y los lotes de versiones (cada uno se valida con este CI).

### 3.8 P-05 — Bus y `/audio` en loopback con Origin validado (incluye enmienda ADR 0027)

- **Estado (2026-11-13).** **Hecho.** PR 1 (bind y enmienda del ADR 0027) en el PR #116 y PR 2 (`Origin` y `approved` estricto) en el PR #117, con las pruebas manuales escritas en sus comentarios (red, web de otro origen, cliente de desarrollo y binario compilado). Medido en Windows: un cliente que usa `localhost` conecta en 2 ms aunque el servidor solo escuche en `127.0.0.1`. Queda como residuo, anotado en la enmienda, que otro proceso local en `::1` puede recibir a los clientes que usan `localhost`.
- **Objetivo.** El core-host escucha solo en `127.0.0.1` salvo `SHIRO_BIND_HOST`. Rechaza `Origin` ajenos en el WebSocket y en `/audio`, y el gate de aprobación solo acepta `approved === true`. Es la secuencia 2a del ADR 0027.
- **Qué cierra.** L-SEG-01, L-PROD-01 y L-DOC-01 (la parte del ADR). Hallazgos R-002, R-003 (parte 2a), R-004 (parte de bind y Origin; token en P-40), R-277, R-153, R-250, R-251 y R-271 (en el ADR). Adelanta `approved === true` de L-SEG-14.
- **PRs.** 2.
  1. `fix: bus y audio en loopback (incluye enmienda ADR 0027)`. La enmienda de ADR 0027 va en este PR.
  2. `fix: allowlist de Origin y approved estricto`.

#### PR 1 — bind

**Archivos a tocar**

| Archivo:línea                                                           | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core-host/src/transports/bind-host.ts` (nuevo)                | `export const DEFAULT_BIND_HOST = '127.0.0.1'`; `resolveBindHost(env: NodeJS.ProcessEnv): { host: string; isLoopback: boolean }`. Vacío o ausente → default. Loopback = `127.0.0.0/8`, `::1` o `localhost`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/core-host/src/transports/websocket-server-transport.ts:49-56` | Opción `host?: string` (doc: default `127.0.0.1`, ver ADR 0027 2a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ídem `:98`                                                              | `this.httpServer.listen(options.port, options.host ?? DEFAULT_BIND_HOST)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ídem `:89-92`                                                           | El log dice `escuchando en <host>:<port>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ídem, después de `:160`                                                 | Getter `get address(): string` (la IP vinculada, igual que `port`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/core-host/src/bootstrap.ts:63-79, 107-111`                    | Opción `host?: string` en `BootstrapOptions`, pasada al transport                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/core-host/src/server.ts:48-59`                                | `const bind = resolveBindHost(process.env)`; si `!bind.isLoopback` → `logger.warn('SHIRO_BIND_HOST=<x> no es loopback: el bus queda sin auth en la red hasta P-40 (ADR 0027 2b)')`. Pasar `host: bind.host` a `bootstrap`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.env.example:7`                                                        | `SHIRO_BIND_HOST=127.0.0.1` con comentario (opt-in consciente, ADR 0027 §3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/adr/0027-autenticacion-token-bus-stt-multicliente.md`             | Sección nueva `## Enmienda (2026-11-…): secuencia 2a/2b y correcciones`. Contenido: (a) **2a, ya**: bind `127.0.0.1` del bus, `/audio`, Letta y Whisper (P-05, P-06a, P-06b), allowlist de `Origin`, topes de Whisper y `approved === true`. Mientras no haya token, una conexión **sin** `Origin` se acepta porque el bind es loopback. **2b**, tras el gate óptico de la estación: `hello` con token, `clientId`, propiedad de la aprobación (P-38/P-40). (b) §4: la allowlist es `http://tauri.localhost` (Windows, sin `useHttpsScheme`), `http://localhost:5173` y `http://127.0.0.1:5173`; `tauri://localhost` era incorrecto (R-153). (c) Notas: la ruta real es `packages/core-host/src/pipeline/approval-gate.ts`. (d) Trampa de `MANAGED_KEYS` (`secrets-file.ts:25`): un `SHIRO_BUS_TOKEN` en `secrets.env` se ignoraría y se borraría en el siguiente `secrets:save`; 2b debe ampliarlo. (e) El CMD de `services/whisper/Dockerfile:52` ignora `WHISPER_HOST`: dentro del contenedor se queda `0.0.0.0` y la publicación se acota en compose (`127.0.0.1:8765:8765`). (f) Residuos aceptados hasta 2b: un proceso local sin `Origin` puede conectarse, recibir `memory:snapshot` (`bootstrap.ts:214-224`) y mandar `secrets:save` (`bootstrap.ts:254`) |

**Test rojo primero**

| Archivo                                                                       | Caso                                                                                                                                                                   | Qué comprueba                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core-host/tests/unit/transports/websocket-server-transport.test.ts` | `escucha en 127.0.0.1 por defecto`                                                                                                                                     | `t.address === '127.0.0.1'`. Para que falle por aserción y no por compilación, el getter `address` va en un commit previo sin cambio de conducta; antes del fix devuelve `'::'`                                                                          |
| ídem                                                                          | `respeta un host explícito`                                                                                                                                            | Con `host: '0.0.0.0'`, `t.address === '0.0.0.0'`                                                                                                                                                                                                         |
| ídem                                                                          | `no acepta conexiones por una IP no-loopback de la máquina`                                                                                                            | Busca la primera IPv4 no interna con `os.networkInterfaces()`. Si no hay, `it.skipIf` con el motivo escrito («sin interfaz no-loopback en este runner»). Con ella, `new WebSocket('ws://<ip>:<port>/bus')` emite `error` con `ECONNREFUSED`. Hoy conecta |
| `packages/core-host/tests/unit/transports/bind-host.test.ts` (nuevo)          | `default 127.0.0.1`, `respeta SHIRO_BIND_HOST`, `cadena vacía usa el default`, `marca 0.0.0.0 y una IP de LAN como no-loopback`, `marca ::1 y localhost como loopback` | Lógica pura                                                                                                                                                                                                                                              |
| `packages/core-host/tests/integration/bootstrap.test.ts`                      | `bootstrap escucha en 127.0.0.1 por defecto`                                                                                                                           | `result.transport.address === '127.0.0.1'`                                                                                                                                                                                                               |

#### PR 2 — Origin y `approved` estricto

**Archivos a tocar**

| Archivo:línea                                                | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core-host/src/transports/origin-policy.ts` (nuevo) | `DEFAULT_ALLOWED_ORIGINS = ['http://tauri.localhost', 'http://localhost:5173', 'http://127.0.0.1:5173']`; `isOriginAllowed(origin: string \| undefined): boolean`. Comparación exacta; `undefined` → `true` (regla 2a). Sin variable de entorno: los orígenes configurables llegan con ADR 0032                                                                                                                                                                                                                                                                                                         |
| `websocket-server-transport.ts:83-86, 112-114`               | Pasar a `new WebSocketServer({ noServer: true })` y manejar `this.httpServer.on('upgrade', …)`: si el path no es el del bus → `400` y `socket.destroy()`; si `!isOriginAllowed(req.headers.origin)` → escribir `HTTP/1.1 403 Forbidden` y destruir el socket, con log `warn` del origin rechazado; si pasa → `this.server.handleUpgrade(req, socket, head, ws => this.server.emit('connection', ws, req))`. La documentación de `ws` desaconseja `verifyClient` y recomienda el evento `upgrade` (consultada el 2026-11-12). Opcional, 1 línea: `maxPayload: 1_048_576` (el default de `ws` es 100 MiB) |
| `packages/core-host/src/audio/audio-route.ts:44-56`          | Quitar los dos `Access-Control-Allow-Origin: *`. Si `req.headers.origin` está presente y no permitido → `403`. Si está permitido → `Access-Control-Allow-Origin: <origin>` y `Vary: Origin`. Sin `Origin` → sin cabecera CORS. El cliente usa `crossOrigin='anonymous'` (`useTtsPlayback.ts:149`), así que necesita el eco exacto para el lip-sync                                                                                                                                                                                                                                                      |
| `packages/core-host/src/pipeline/approval-gate.ts:50`        | `entry.resolve(p.approved === true)`. Si llega algo que no es booleano → `logger.warn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Test rojo primero**

| Archivo                                                           | Caso                                                                                                                                                                                                   | Qué comprueba                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `websocket-server-transport.test.ts`                              | `rechaza con 403 un Origin ajeno`                                                                                                                                                                      | `new WebSocket(url, { origin: 'https://evil.example' })` emite `unexpected-response` con `statusCode === 403` y `clientCount === 0` |
| ídem                                                              | `un Origin rechazado no dispara los connection handlers`                                                                                                                                               | `onConnection(spy)` → `spy` no se llama (no hay fuga de `memory:snapshot`)                                                          |
| ídem                                                              | `acepta http://tauri.localhost` y `acepta http://localhost:5173`                                                                                                                                       | Conexión `open`                                                                                                                     |
| ídem                                                              | `acepta un cliente sin Origin (2a, sin token)`                                                                                                                                                         | Cliente Node normal conecta                                                                                                         |
| ídem                                                              | `un path distinto de /bus no hace upgrade`                                                                                                                                                             | `ws://127.0.0.1:<port>/otro` falla                                                                                                  |
| `packages/core-host/tests/unit/audio/audio-route.test.ts` (nuevo) | `no devuelve Access-Control-Allow-Origin: *`, `eco del Origin permitido con Vary: Origin`, `403 con Origin ajeno`, `sin Origin sirve el audio sin cabecera CORS`, `410 para un id caducado sin CORS *` | Handler con `AudioCache` real y un `http.createServer` efímero en `127.0.0.1`                                                       |
| `packages/core-host/tests/unit/pipeline/approval-gate.test.ts`    | `approved "false" (cadena) no aprueba` y `approved 1 no aprueba`                                                                                                                                       | Emite `tool:approval` con el valor casteado a `unknown as boolean`; `decision` resuelve `false`. Hoy resuelve `"false"` y `1`       |

**Pasos (los dos PRs)**

1. PR 1: rama `feat/pipe/p05-loopback`. Commit 1: getter `address` (sin cambio de conducta). Commit 2: tests rojos. Commit 3: `bind-host.ts`, transport, bootstrap, server, `.env.example`. Commit 4: `docs: enmienda ADR 0027 — secuencia 2a/2b y correcciones`.
2. `npm run verify`. El agente hace la prueba manual de bind (abajo) y fusiona tras la revisión con opus y el CI en verde.
3. PR 2: rama `feat/pipe/p05-origin` desde `develop` actualizado. Tests rojos, después `origin-policy.ts`, upgrade, audio-route y approval-gate.
4. `npm run verify` y prueba manual de Origin con el cliente real (abajo). Revisión con opus (el plan lo pide para PRs de seguridad).

**Criterio de hecho**

- `npm run verify` verde, con los casos nuevos verdes y rojos en el commit anterior.
- PR 1, el agente: con `npm run dev` arrancado, `netstat -ano | findstr :9876` muestra solo `127.0.0.1:9876 … LISTENING` (ninguna línea `0.0.0.0` ni `[::]`).
- PR 2, el agente: (a) en la consola de DevTools de cualquier web abierta en el navegador, `new WebSocket('ws://localhost:9876/bus')` falla y el log del core-host muestra `Origin rechazado: https://…`; (b) el chat del cliente funciona (texto, voz y lip-sync) con `npm run dev` (Origin `http://localhost:5173`); (c) **cliente empaquetado** (Origin `http://tauri.localhost`), ver la nota siguiente.
- **Prueba con WebView2 y binario compilado en local** (D13, §2.0 B6): Rust 1.96 ya está instalado (fuera del PATH del usuario: el agente añade la ruta de cargo a la sesión). El binario 0.1.0 antiguo se desinstaló el 13-nov conservando los datos de la app. El agente compila el binario con el código del PR (`npm run build:sidecar -w @proyecto-shiro/desktop` y `npm run tauri:build -w @proyecto-shiro/desktop`) y abre el binario resultante. En el log debe salir la conexión aceptada (y ningún `Origin rechazado: http://tauri.localhost`), y el chat y el audio deben funcionar.

**Tamaño, quién y horas.** PR 1 ≈ 150 líneas de código y tests más ≈ 60 del ADR; PR 2 ≈ 200 líneas · mixto (agente escribe; revisión con opus; el agente hace las pruebas manuales y fusiona) · 4,5 h.

**Riesgos y reversión.**

- El Origin real del binario no es el esperado → el cliente instalado no conecta. Se detecta en la prueba (c). Mitigación: el log escribe el Origin rechazado, así que se añade a la lista. Reversión: revertir PR 2 (PR 1 sigue sirviendo).
- `localhost` → `::1` en algún cliente Node (D18). Mitigación: tests con `127.0.0.1`; si falla algo real, se cambian las URLs de config del core-host (no las del cliente, por la CSP).
- Con `SHIRO_BIND_HOST` distinto de loopback, `/audio` sigue anunciando `http://localhost:<port>` (`bootstrap.ts:308`) y un cliente remoto no oiría nada. Queda fuera de alcance (P-14/P-35). El `warn` de `server.ts` lo hace visible.
- Reversión general: revertir los PRs. No hay datos ni formatos persistidos.

**Depende de:** nada (P-02 conviene antes, para tener `verify`). **Desbloquea:** el gate 2 y 3 de F1; P-34 (topología), P-38/P-40 (2b); el backup en otro equipo (P-11a) con el bus ya cerrado.

### 3.9 P-06a — Compose en loopback y Letta fijada por digest

- **Objetivo.** Letta y Whisper publicados solo en loopback salvo override, Letta fijada a la imagen que funciona hoy, y profiles para no levantar Whisper si no se pide.
- **Qué cierra.** L-HOME-01, L-TOOL-02 (fijar Letta; «Whisper nativo» se documenta en P-06b) y la parte de compose de L-SEG-10 y L-SEG-17. Hallazgos R-315, R-213, R-326 (parte de la versión), R-327 y la parte de compose de R-031, R-033 y R-053 (Letta).
- **PRs.** 1: `chore: compose en loopback y Letta fijada`. Sin ADR (la enmienda de ADR 0027 de P-05 ya cubre el bind).
- **Estado (2026-11-13).** **Hecho** en el PR #134, con la prueba manual en su descripción. Diferencias con lo escrito abajo: la imagen va solo por digest, sin etiqueta de versión (la imagen local solo tenía `latest`; es Letta 0.16.8 y queda anotado en el comentario). «Recrear no toca el volumen» solo vale si el despliegue previo salió de este compose: con otro volumen u otro Postgres hay que migrar los datos antes, con copia previa (así se hizo en el equipo del dueño; el detalle está en el PR). Quedan para P-06b el `CMD` de Whisper (dentro del contenedor sigue en `0.0.0.0`) y la base CUDA por digest. Queda para después, visto en la prueba: con Ollama recién arrancado las escrituras a Letta superan su tope de 10 s y el drenado, al reintentar, duplica recuerdos.

**Archivos a tocar**

| Archivo:línea                              | Cambio                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml:26`                    | `image: letta/letta:<versión>@sha256:<digest>` con el valor que saca el agente y un comentario: fecha, «versión probada con @letta-ai/letta-client ^1.12.0 (`packages/core/package.json:25`); subirla junto al SDK, con backup previo»                                                          |
| `docker-compose.yml:28-29`                 | `- '${LETTA_BIND:-127.0.0.1}:8283:8283'`                                                                                                                                                                                                                                                        |
| `docker-compose.yml:70-71`                 | `- '${WHISPER_BIND:-127.0.0.1}:8765:8765'`                                                                                                                                                                                                                                                      |
| `docker-compose.yml:60` (servicio whisper) | `profiles: ['stt']` (decidido, §2.0 B2). Letta sin profile: siempre arranca                                                                                                                                                                                                                     |
| `docker-compose.yml:3-22`                  | Cabecera actualizada: `docker compose up -d` levanta Letta; `docker compose up -d whisper` o `docker compose --profile stt up -d` levantan Whisper; `LETTA_BIND`/`WHISPER_BIND` solo para exponer a la LAN a sabiendas (sin auth hasta P-40); cómo subir Letta (backup, `pull`, prueba de humo) |

Según la documentación de Compose (consultada el 2026-11-12), los servicios sin `profiles` arrancan siempre, y un servicio con profile se activa al nombrarlo en la línea de comandos (`docker compose up -d whisper`). Lo que sí cambia es el flujo: `docker compose up -d` a secas **deja de levantar Whisper**, y el health del Setup lo marcará en rojo si no se arranca. `README.md:247,273` y `services/whisper/README.md:13` ya nombran el servicio (`up -d letta` / `up -d whisper`); la línea sobre el profile va con P-03a (§3.14), y el aviso claro en el Setup, en P-12.

**Test rojo primero.** No hay test automático razonable para compose en esta fase. El «rojo» es la comprobación manual previa: con el compose actual, `netstat -ano | findstr ":8283 :8765"` muestra `0.0.0.0`. Opcional y barato: un paso de CI `docker compose config -q` que valide la sintaxis (sin arrancar nada).

**Pasos**

1. **El agente** arranca Docker Desktop y obtiene el digest de la imagen que hoy funciona, **sin hacer pull**: `docker image ls --digests letta/letta`. La versión, si la imagen la etiqueta: `docker image inspect letta/letta:latest --format "{{json .Config.Labels}}"` (que tenga la etiqueta de versión está **sin verificar**). Si `latest` local no tiene digest de repositorio, se anota el ID y se decide con Pipe.
2. Agente: rama `feat/pipe/p06a-compose-loopback`, cambios de la tabla y `docker compose config -q`.
3. El agente, prueba manual: `docker compose up -d` (solo Letta), `docker compose up -d whisper`, `netstat` y un turno con memoria.

**Criterio de hecho**

- `docker compose config` muestra `host_ip: 127.0.0.1` en los dos puertos y la imagen de Letta con `@sha256:`.
- `netstat -ano | findstr ":8283 :8765"` → solo `127.0.0.1`. El Postgres de Letta no aparece (no se publica en compose).
- `curl http://127.0.0.1:8283/v1/health/` responde. Con `npm run dev`, el setup marca Letta y Whisper en verde y un turno de chat se guarda y se recuerda al recargar (igual que antes).
- `docker compose up -d` sin argumentos no levanta Whisper; `docker compose up -d whisper` sí.
- Con Whisper parado, el Setup lo marca en rojo (conducta esperada, no un fallo). El agente lo comprueba una vez; el texto del aviso («arranca Whisper con `docker compose up -d whisper`») se mejora en P-12.

**Tamaño, quién y horas.** ~30 líneas · mixto (el agente saca el digest, edita y prueba) · 2 h.

**Riesgos y reversión.**

- Con Docker Desktop en Windows, el health del core-host (`system-health.ts:30-31`, `http://localhost:…`) podría intentar `::1` primero. Node 22 reintenta por IPv4 (D18), pero con `fetch` está **sin verificar**. Si el setup marca Letta en rojo con el contenedor sano, se cambian a `127.0.0.1` las URLs de `config/modules.config.yaml:47,83` y los defaults de `system-health.ts`.
- Recrear el contenedor con el digest no toca el volumen `letta_pgdata`. Aun así, no se hace `down -v` nunca.
- Reversión: revertir el commit y `docker compose up -d`.

**Depende de:** Docker arrancado (lo arranca el agente). **Desbloquea:** P-06b; P-11a (backup con `pg_dump` contra la imagen fijada); el gate 2 de F1.

### 3.10 P-06b — Whisper con topes, bind y sin root, con job pytest mínimo (incluye enmienda ADR 0019)

- **Objetivo.** El servicio STT corta streams y cuerpos por encima del tope, rechaza `Origin` ajenos, corre sin root, respeta `WHISPER_HOST` y tiene un job de CI con el test del tope.
- **Qué cierra.** L-SEG-10 y L-SEG-17 (con P-06a). Hallazgos R-006, R-033, R-031, R-032 (la parte de Origin y CORS; el token es P-40), R-052, R-053 (Whisper y la base CUDA, ver D9) y R-221 (Whisper nativo documentado). El test del tope adelanta L-TEST-04; el resto de la suite Python va en P-18.
- **PRs.** 1: `fix: topes y bind en Whisper (incluye enmienda ADR 0019)`. La enmienda de ADR 0019 va en el mismo PR.
- **Estado (2026-11-13).** **Hecho** en el PR #136, con la prueba real en su descripción (imagen reconstruida: usuario `shiro`, modelo descargado al volumen nuevo, un clip de voz transcrito, 1009 al pasar de 90 s, 1001 por inactividad, 413 y `Origin` ajeno rechazado). Diferencias con lo escrito abajo: los topes y `WHISPER_SAMPLE_RATE` no admiten valores menores o iguales que cero (vuelven al valor por defecto con un aviso) y los orígenes se normalizan; compose pasa `WHISPER_MAX_AUDIO_SECONDS`, `WHISPER_IDLE_TIMEOUT_S` y `WHISPER_ALLOWED_ORIGINS` al contenedor; el job instala las versiones que hoy fija `requirements.txt` y usa `actions/setup-python@v7`; y `test_transcribe_empty_body_returns_empty`, que estaba roto, pasa de rebote, así que a P-18 le queda un test. Con esto queda completa la entrega 2a de ADR 0027. Queda para después: una sesión de `/stt` sin audio se puede mantener abierta mandando mensajes de control (el buffer sí está acotado); lo cierra el token de P-40.

**Archivos a tocar**

| Archivo:línea                                           | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/whisper/config.py:37-39, 60-72`               | Default `WHISPER_HOST` → `127.0.0.1`. Campos nuevos: `max_audio_seconds` (`WHISPER_MAX_AUDIO_SECONDS`, 90; decidido, §2.0 B3), `idle_timeout_s` (`WHISPER_IDLE_TIMEOUT_S`, 15), `allowed_origins` (`WHISPER_ALLOWED_ORIGINS`, separados por comas; default los tres de P-05) y la propiedad `max_audio_bytes = sample_rate * 2 * max_audio_seconds` (90 s a 16 kHz Int16 = 2 880 000 bytes)                                                                       |
| `services/whisper/main.py:75-80`                        | CORS: `allow_origins=list(config.allowed_origins)`, `allow_methods=["GET","POST"]`, `allow_headers=["Content-Type"]`                                                                                                                                                                                                                                                                                                                                              |
| `services/whisper/main.py:97-118`                       | `/transcribe` recibe `Request`: si `Content-Length` > `max_audio_bytes` → 413; si no, lee `request.stream()` acumulando y corta con 413 al pasar el tope (D12). El resto, igual                                                                                                                                                                                                                                                                                   |
| `services/whisper/main.py:128-135`                      | Antes de `ws.accept()`: si hay `origin` en `ws.headers` y no está en `allowed_origins` → `await ws.close(code=1008)` (Starlette responde 403 al handshake) y `logger.warning`                                                                                                                                                                                                                                                                                     |
| `services/whisper/main.py:142-163`                      | `msg = await asyncio.wait_for(ws.receive(), timeout=config.idle_timeout_s)`; si salta el timeout → `_emit_error(…, "sesión inactiva")` y cerrar con 1001. Tras `buffer.extend(...)`, si `len(buffer) > config.max_audio_bytes` → `_emit_error(…, "audio demasiado largo")`, `ws.close(code=1009)` y salir. Una bandera `closed` evita el segundo `close()` en el `finally` (`:194-198`). Un semáforo de sesiones concurrentes queda opcional (fuera del criterio) |
| `services/whisper/Dockerfile:9`                         | `FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04@sha256:<digest>` (el agente lo saca con `docker image ls --digests nvidia/cuda`), con comentario y fecha                                                                                                                                                                                                                                                                                                       |
| `services/whisper/Dockerfile:11-15`                     | `HF_HOME=/home/shiro/.cache/huggingface`, `WHISPER_HOST=0.0.0.0`, `WHISPER_PORT=8765` (dentro del contenedor tiene que ser 0.0.0.0; la frontera está en compose)                                                                                                                                                                                                                                                                                                  |
| `services/whisper/Dockerfile` antes de `:47`            | `RUN useradd --create-home --uid 10001 shiro && mkdir -p /home/shiro/.cache/huggingface && chown -R shiro:shiro /home/shiro` y `USER shiro`                                                                                                                                                                                                                                                                                                                       |
| `services/whisper/Dockerfile:52`                        | `CMD ["python", "-m", "services.whisper.main"]` (`run()` usa `config.host` y `config.port`, `main.py:201-211`)                                                                                                                                                                                                                                                                                                                                                    |
| `docker-compose.yml:105-108`                            | `whisper_hf_cache:/home/shiro/.cache/huggingface` (volumen nuevo, D10) y declararlo en `volumes:`. El volumen viejo `whisper_models` se deja como está; borrarlo es decisión de Pipe                                                                                                                                                                                                                                                                              |
| `services/whisper/tests/test_limits.py` (nuevo)         | Tests de la tabla siguiente                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `services/whisper/tests/test_config.py:49`              | Esperar `127.0.0.1` (si no, este test queda rojo cuando P-18 meta la suite entera)                                                                                                                                                                                                                                                                                                                                                                                |
| `.github/workflows/ci.yml` (job nuevo `whisper-limits`) | `runs-on: ubuntu-latest`, `timeout-minutes: 5`, `actions/checkout` y `actions/setup-python` (Python 3.11; versión y pin al estilo que deje P-04), `pip install fastapi==0.115.6 httpx==0.28.1 numpy==2.2.1 pytest==8.3.4` (las de `requirements.txt`, sin faster-whisper), `python -m pytest services/whisper/tests/test_limits.py -q` desde la raíz                                                                                                              |
| `services/whisper/README.md:80, 142-148`                | Tabla de variables (host `127.0.0.1` nativo / `0.0.0.0` en el contenedor y publicado en loopback; topes y orígenes nuevos); el enlace de seguridad pasa de ADR 0025 a ADR 0027; sección «Whisper nativo en Windows» como alternativa a Docker (venv, `python -m services.whisper.main`, bind loopback por defecto)                                                                                                                                                |
| `docs/adr/0019-…md`                                     | Sección `## Enmienda (2026-11-…): topes, bind y usuario`: bind por capas (código 127.0.0.1, contenedor 0.0.0.0 con publicación loopback), topes (90 s configurables → 1009, 15 s de inactividad → 1001, 413 en `/transcribe`), Origin en `/stt` antes de `accept`, `USER` no root y volumen nuevo, base CUDA por digest, Whisper nativo como alternativa. El ejemplo `ports: ['8765:8765']` de `:69` se marca como superado                                       |

**Test rojo primero** (`services/whisper/tests/test_limits.py`, con un `_FakeTranscriber` igual al de `test_transcribe.py:18-28`, el singleton parcheado con `monkeypatch.setattr(t_mod, "_singleton", fake)` y `main.config` sustituido por `dataclasses.replace(config, max_audio_seconds=1, idle_timeout_s=1)`)

| Caso                                           | Qué comprueba                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_stt_closes_1009_when_buffer_exceeds_cap` | Con `max_audio_seconds=1` (tope de 32 000 bytes), `TestClient(app).websocket_connect('/stt')` y varios `send_bytes(b"\0" * 8000)` hasta pasar el tope; después, leer hasta `WebSocketDisconnect` y comprobar `code == 1009`. La lectura va en un `threading.Thread` con `join(timeout=5)`: si el hilo sigue vivo, `pytest.fail("no cerró con 1009 en 5 s")`. Así, contra el código actual el test **falla** en 5 s en vez de colgarse (`pytest.mark.timeout` no está instalado). **Este es el único que exige el gate** |
| `test_transcribe_413_when_body_exceeds_cap`    | `POST /transcribe` con `max_audio_bytes + 1` bytes → 413. Hoy 200                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `test_stt_rejects_foreign_origin`              | `websocket_connect('/stt', headers={'origin': 'https://evil.example'})` falla (`WebSocketDisconnect` con 1008). Hoy acepta                                                                                                                                                                                                                                                                                                                                                                                              |
| `test_stt_accepts_tauri_origin`                | Con `origin: http://tauri.localhost`, conecta; `{"type":"stop"}` devuelve `transcribed`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `test_config_default_host_is_loopback`         | `Config.from_env()` sin variables → `host == "127.0.0.1"`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

El job de CI corre solo `test_limits.py`. Los tests rotos de R-194 (`test_health.py`, `test_transcribe.py`) no entran hasta P-18.

**Pasos**

1. Esperar a que P-06a y P-04 PR 2 estén en `develop`. Rama `feat/pipe/p06b-whisper-topes`.
2. Tests rojos. El rojo se demuestra **en local** (el agente pega en el PR la salida de `python -m pytest services/whisper/tests/test_limits.py -q` con los fallos); el job de CI entra en el mismo commit que el arreglo, para no dejar un commit con CI colgado o rojo en el historial del PR.
3. `config.py`, `main.py`, `Dockerfile`, compose, README del servicio y enmienda de ADR 0019.
4. El agente saca el digest de la base CUDA (Docker arrancado, sin pull).
5. CI verde. El agente reconstruye y prueba (abajo).

**Criterio de hecho**

- CI: el job `whisper-limits` en verde y `verify` en verde.
- El agente: `docker compose build whisper && docker compose up -d whisper` (la primera vez descarga de nuevo el modelo `small` en el volumen nuevo). `docker compose exec whisper id -u` → `10001`. `netstat -ano | findstr :8765` → solo `127.0.0.1`. Un turno por voz funciona como antes (push-to-talk, partials, final); hablar al micro es de Pipe, o el agente envía un clip grabado al WS.
- El agente: mantener abierto el push-to-talk (o un stream de prueba al WS `/stt`) más de 90 s → el cliente muestra el error `WS cerrado sin transcripción final (code=1009)` (`whisper-stt-client.ts:190`). Ese texto es mejorable; queda para P-42.

**Tamaño, quién y horas.** ≈ 250 líneas (≈ 90 Python, ≈ 80 tests, ≈ 20 Docker/compose/CI, ≈ 60 docs) · mixto · 4 h.

**Riesgos y reversión.**

- Tope de 90 s demasiado corto para un mensaje largo de Pipe → se sube con `WHISPER_MAX_AUDIO_SECONDS` en `.env` sin tocar código (§2.0 B3).
- El usuario no root no puede escribir la caché → falla al descargar el modelo. Por eso se usa un volumen nuevo (Docker copia el contenido y los permisos del punto de montaje solo cuando el volumen está vacío; es conducta documentada de los volúmenes con nombre, aquí **sin verificar** con Docker Desktop en Windows). Plan B: `chown` en un entrypoint.
- `asyncio.wait_for` sobre `ws.receive()` cancela la espera; los partials en curso (`to_thread`) terminan solos. Riesgo bajo.
- `--ws-max-size` de uvicorn (16 MiB por mensaje, docs de uvicorn consultadas el 2026-11-12) no limita el stream completo: por eso hace falta el tope propio.
- Reversión: revertir el commit; el volumen viejo `whisper_models` sigue ahí con el modelo, y `docker compose up -d whisper` vuelve al estado anterior.

**Depende de:** P-06a (compose) y P-04 (ci.yml). **Desbloquea:** el gate 2 y 3 de F1; P-18 (suite Python completa); P-40 (token en `/stt`); mover Whisper a otro equipo.

### 3.11 P-07b — Audio global con `AudioProvider`

- **Estado (2026-11-13).** **Hecho** en el PR #121, con la prueba manual escrita en su descripción. Además de lo pedido, el fin de cada audio se emite una sola vez y también al desmontar el reproductor. Sin probar con Live2D (riesgo B11): los assets no están instalados.
- **Objetivo.** Que la voz de Shiro no se corte al cambiar de pantalla y que las respuestas que llegan en otra pantalla suenen.
- **Qué cierra.** L-BUG-02 (R-058 y R-119).
- **PRs (1):** `fix: AudioProvider global para la voz de Shiro`.

**Archivos a tocar**

| Archivo                                                                      | Cambio                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/audio/audio-context.tsx` (nuevo)                       | `AudioProvider({ children, audioFactory? })`: llama **una vez** a `useTtsPlayback({ bus, audioFactory })` y publica `{ muted, setMuted, cancel, audioElement }` por context. Mismo patrón que `state/companion-context.tsx`.                                                                            |
| `packages/desktop/src/audio/use-audio.ts` (nuevo)                            | `useAudio()`; lanza «useAudio debe usarse dentro de AudioProvider» fuera del provider.                                                                                                                                                                                                                  |
| `packages/desktop/src/App.tsx:44-55`                                         | `<AudioProvider>` dentro de `CompanionProvider` y fuera del `ErrorBoundary` (un fallo de render no corta el audio). Actualizar el comentario de cabecera (`:1-16`).                                                                                                                                     |
| `packages/desktop/src/screens/Conversation/ConversationScreen.tsx:32, 72-75` | Quitar el import y la llamada a `useTtsPlayback`; `const ttsPlayback = useAudio();`. El resto del archivo no cambia (usa `cancel`, `muted`, `setMuted` y `audioElement`).                                                                                                                               |
| `packages/desktop/src/screens/Avatar/AvatarScreen.tsx:25-31`                 | Pasar `audioElement={useAudio().audioElement}` al `<Avatar>`: la vista ampliada también mueve la boca.                                                                                                                                                                                                  |
| `packages/desktop/src/audio/useTtsPlayback.ts:108-121, 154-175`              | R-119: `stopCurrent` marca el audio que corta (un `WeakSet` en un ref) **antes** de `audio.src = ''`; `finish` no emite `tts:audio-ended` para un audio marcado. El que corta ya emite su propio fin cuando toca (`tts:cancel`, `:184-189`). Cabecera (`:6-8`): «se monta una vez, en `AudioProvider`». |

**Test rojo primero**

- `packages/desktop/tests/audio/audio-provider.test.tsx` (nuevo). Usa `vi.stubGlobal('Audio', FakeAudio)` para que el test valga igual antes y después del cambio, `vi.mock` de `components/Avatar` y un `ResizeObserver` falso.
  - `desmontar ConversationScreen no corta el audio ni emite tts:audio-ended`: monta `ConversationScreen` dentro de los providers, emite `tts:audio`, desmonta la pantalla (un interruptor en el harness) y comprueba `paused === false` y cero `tts:audio-ended`. **Se escribe primero contra el árbol actual** (BusProvider + CompanionProvider) y falla porque el cleanup de la pantalla pausa el audio (`useTtsPlayback.ts:191-195`). Al añadir `AudioProvider` el harness lo incluye.
  - `un tts:audio que llega con otra pantalla montada suena y emite tts:audio-ended al terminar`
  - `useAudio fuera de AudioProvider lanza un error claro`
- `packages/desktop/tests/audio/useTtsPlayback.test.tsx`: el `FakeAudio` (`:43-67`) gana un setter de `src` que dispara `error` al asignar `''`, como hace el navegador.
  - `cortar un audio al llegar otro no emite tts:audio-ended del anterior` (falla hoy: `finish` del primero emite).
  - `tts:cancel emite exactamente un tts:audio-ended` (hoy emite dos con el fake nuevo).
  - Los 10 tests actuales siguen en verde.

**Pasos**

1. Escribir los tests rojos (los dos de `useTtsPlayback` y el de desmontaje).
2. Arreglar R-119 en `useTtsPlayback`.
3. Crear `AudioProvider` y `useAudio`; montarlo en `App`; cambiar `ConversationScreen` y `AvatarScreen`.
4. `npm run verify`.

**Criterio de hecho**

- Tests nuevos en verde; `git grep -n "useTtsPlayback(" packages/desktop/src` devuelve **una sola** llamada (en `audio-context.tsx`).

**Prueba manual (el agente, mirando el estado del elemento de audio y el indicador «Hablando…»; escucharlo es opcional para Pipe), con `npm run dev` y TTS activo:** pedir una respuesta larga, cambiar a Setup mientras habla y volver: la frase no se corta y al terminar desaparece «Hablando…». Pedir otra respuesta, irse a Módulos antes de que llegue: suena igualmente. Con los assets de Live2D instalados, además: volver al chat con un audio sonando y anotar si la boca se mueve (ver riesgo).

**Tamaño y quién.** ≈ 160 líneas, agente (sonnet), 1 h (incluye la prueba manual).

**Riesgos y reversión.**

- Ahora la voz suena en cualquier pantalla. Es lo que pide R-058; si molesta en Setup, el botón de silencio sigue en el chat (persistido en `localStorage`).
- Live2D (tabla B, fila B11): volver a la pantalla con un audio sonando deja ese audio sin lip-sync y acumula un `AudioContext` por visita. No afecta al orbe. Live2D está aparcado: solo se anota y, si Pipe lo ve en la prueba, va a la cola.
- Reversión: revertir el PR devuelve el hook a la pantalla. El arreglo de R-119 es independiente y se puede conservar.

**Depende de:** nada. **Desbloquea:** P-07a PR2 (mismos archivos), el gate 5 de F1 y cualquier cliente futuro que necesite un único reproductor.

### 3.12 P-07a — Conexión visible en el cliente

- **Estado (2026-11-13).** **Hecho.** PR 1 (contrato `IObservableTransport`, `onStateChange` y `send()` que rechaza sin conexión, con la enmienda del ADR 0013) en el PR #127 y PR 2 (aviso de conexión, envío y micro deshabilitados, `CONNECTION_LOST`, Setup con tope de 8 s) en el PR #131, con la prueba manual en su descripción. Diferencias con lo escrito abajo: el estado inicial con `autoConnect: false` es `closed`; `close()` es idempotente; `useMicrophonePTT` gana `cancel()` para cortar el micro sin pedir la transcripción; y la gracia del aviso es un hook compartido (`useDisconnectedFor`) que también usa Setup. Queda para después bajar a aviso el `ERROR` que `EventBus` registra por cada envío sin conexión. Decidido por el dueño el 2026-11-13 y hecho en el PR #133: una caída corta la frase que Shiro esté diciendo y el chat lo avisa («Hay un problema con la conexión: se cortó lo que Shiro estaba diciendo.») hasta el turno siguiente.
- **Objetivo.** Que Pipe vea cuándo Shiro no está conectada, que no pueda escribir ni hablar a la nada, y que la UI no se quede en «pensando» para siempre si el bus se cae a mitad de turno.
- **Qué cierra.** L-BUG-10 (R-068, R-082, R-118, R-120) y L-PROD-05 en su parte de conexión (R-282, R-298, R-287, R-284 parcial). **No cierra** R-306 (comandos del Setup que suponen un clon del repo): queda en el lote para un PR aparte, porque el criterio del plan no lo pide y depende de cómo arranque el binario.
- **PRs (2):**
  1. `feat: onStateChange en WebSocketTransport (incluye enmienda ADR 0013)`, solo `packages/core` y docs.
  2. `feat: estado de conexión visible en el cliente`, solo `packages/desktop`.

**Contrato (lo que se declara definitivo y hereda ADR 0033):**

```ts
// packages/core/src/interfaces/ITransport.ts
export type TransportState = 'connecting' | 'open' | 'closing' | 'closed';
export type TransportStateHandler = (state: TransportState) => void;
export interface IObservableTransport extends ITransport {
  getState(): TransportState;
  onStateChange(handler: TransportStateHandler): Unsubscribe;
}
export class TransportNotOpenError extends Error {
  readonly name = 'TransportNotOpenError';
}
```

`ITransport` no cambia: `InProcessTransport` y el transport del servidor siguen igual.

**Archivos a tocar**

| PR  | Archivo                                                                           | Cambio                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/core/src/interfaces/ITransport.ts:1-49`                                 | Tipos de arriba. `TransportNotOpenError` vive en `core/transports/errors.ts` (es una clase, no un tipo) y se exporta desde `index.ts`.                                                                                                                                                                                    |
| 1   | `packages/core/src/core/transports/websocket-transport.ts:84`                     | `type State` se sustituye por `TransportState`; la clase implementa `IObservableTransport` (`:89`).                                                                                                                                                                                                                       |
| 1   | idem `:99, 141, 154, 177, 183, 211`                                               | Cada `this.state = …` pasa por un `private setState(next)` que no hace nada si el estado no cambia y, si cambia, llama a cada listener dentro de `try/catch` (un listener que lanza se loguea y no afecta al resto).                                                                                                      |
| 1   | idem `:122-126`                                                                   | `send()` sin conexión abierta **rechaza** con `TransportNotOpenError` (mantiene el `logger.warn`). `EventBus.emit` ya captura y loguea (`event-bus.ts:60-66`), así que ningún emisor rompe.                                                                                                                               |
| 1   | idem, nuevo método                                                                | `onStateChange(handler)` devuelve la función de baja. Cabecera del archivo (`:13-16`) actualizada: «sin queue local; el emisor se entera por el rechazo y la UI por `onStateChange`».                                                                                                                                     |
| 1   | `packages/core/src/interfaces/index.ts:8`, `packages/core/src/index.ts:36`        | Exportar `IObservableTransport`, `TransportState`, `TransportStateHandler` y `TransportNotOpenError`.                                                                                                                                                                                                                     |
| 1   | `docs/adr/0013-protocolo-websocket-eventbus.md:123`                               | **Enmienda** (fecha y P-07a): el mensaje con la conexión caída sigue sin cola, pero `send()` rechaza y el transport cliente expone `onStateChange`; la UI muestra «reconectando». Es la UI que el propio ADR ya preveía.                                                                                                  |
| 1   | `docs/architecture.md:~671`                                                       | Párrafo «Estado de conexión del transport»: contrato `IObservableTransport`, que es definitivo y que ADR 0033 lo hereda; que solo detecta el **cierre** del socket, no un socket medio abierto (eso es el heartbeat de R-101, en ADR 0033).                                                                               |
| 2   | `packages/desktop/src/connection/connection-context.tsx` (nuevo)                  | `ConnectionProvider({ source?: Pick<IObservableTransport, 'getState' \| 'onStateChange'> })`. Sin `source` (tests, demos con `InProcessTransport`) el estado es `'open'` fijo.                                                                                                                                            |
| 2   | `packages/desktop/src/connection/use-connection.ts` (nuevo)                       | `useConnectionState(): TransportState` con `useSyncExternalStore`. Archivo aparte por la convención de Fast Refresh del repo (`bus-context.tsx:4-6`).                                                                                                                                                                     |
| 2   | `packages/desktop/src/connection/ConnectionBanner.tsx` (nuevo)                    | Banner con `role="status"`: «Conectando con Shiro…» o «Sin conexión con Shiro: reintentando». Aparece tras `BANNER_GRACE_MS = 1000` sin `open` (evita el parpadeo al arrancar y en reconexiones rápidas).                                                                                                                 |
| 2   | `packages/desktop/src/main.tsx:27-41`                                             | `makeProductionBus()` devuelve `{ bus, transport }` y se renderiza `<App bus={bus} connection={transport} />`.                                                                                                                                                                                                            |
| 2   | `packages/desktop/src/App.tsx:37-55, 118`                                         | `AppProps.connection?`. `<ConnectionProvider>` envuelve a `CompanionProvider` (este necesita leer el estado). `<ConnectionBanner />` junto a `<UpdateBanner />` en `AppShell`.                                                                                                                                            |
| 2   | `packages/desktop/src/state/companion-reducer.ts:61-71, 103-178`                  | Acciones nuevas: `CONNECTION_LOST` (pone `thinking`, `listening` y `speaking` a false y vacía `sttLive` y `subtitle`; conserva `history`) y `LISTEN_END` (solo `listening:false`, `sttLive:''`).                                                                                                                          |
| 2   | `packages/desktop/src/state/companion-context.tsx:36-39`                          | Efecto: cuando el estado pasa de `open` a cualquier otro, `dispatch({ type: 'CONNECTION_LOST' })`.                                                                                                                                                                                                                        |
| 2   | `packages/desktop/src/screens/Conversation/ConversationScreen.tsx:82-99, 194-210` | `const connected = useConnectionState() === 'open'`. `sendMessage` sale si `!connected` (`:89`); input, botón de enviar y micro deshabilitados sin conexión (`:86, 199, 207`); placeholder «Sin conexión con Shiro…». Efecto: si `ptt.state === 'error'` y `state.listening`, `dispatch({ type: 'LISTEN_END' })` (R-118). |
| 2   | `packages/desktop/src/health/useSystemHealth.ts:28-50`                            | Timeout `HEALTH_TIMEOUT_MS = 8000`: si no llega `system:health`, `checking:false` y `timedOut:true` (campo nuevo del resultado). `refresh()` reinicia el temporizador. Limpieza en el desmontaje.                                                                                                                         |
| 2   | `packages/desktop/src/screens/Setup/SetupScreen.tsx:92-104, 135-174`              | Con `timedOut` o sin conexión: tarjeta «El core-host no responde» con los pasos que ya existan para reiniciar (no se reescriben los comandos: eso es R-306). Las insignias dejan de mostrar «comprobando…» para siempre.                                                                                                  |
| 2   | `packages/desktop/src/health/useSecretsSave.ts:24-50`                             | `useSecretsSave(bus, connected)`: sin conexión, `save()` pasa a `error` con «Sin conexión con el core-host; no se guardó nada» y no emite (R-120). El llamador en SetupScreen pasa `connected`.                                                                                                                           |

**Lo que no toca (a propósito).** `ToolApprovalModal`: deshabilitar sus botones sin conexión (R-282) cambia el mismo archivo que P-08; se hace en P-08 o en un PR de 10 líneas después de P-08. Heartbeat, resume y reenvío del turno en curso (R-101, mejor arreglo de R-082): ADR 0033.

**Test rojo primero**

PR1, en `packages/core/tests/unit/core/transports/websocket-transport.test.ts` (usa `MockWebSocket` y `makeFakeScheduler`, `:70-96`):

- `onStateChange notifica connecting → open al abrir`
- `onStateChange notifica closed cuando el servidor cierra el socket` (avanzando como mucho 3000 ms del scheduler falso; en la práctica el cambio es inmediato)
- `onStateChange no notifica si el estado no cambia`
- `la función devuelta por onStateChange da de baja al listener`
- `un listener que lanza no impide notificar a los demás`
- `send rechaza con TransportNotOpenError si la conexión no está abierta` → **sustituye** al test actual `send dropea silenciosamente…` (`:165`).
- `close() notifica closing y closed, y después no notifica reconexiones`

PR2, en `packages/desktop/tests/`:

- `connection/connection.test.tsx`, con un `source` falso que tiene `set(state)`:
  - `sin source el estado es open`
  - `muestra el banner tras 1 s sin conexión y lo quita al reconectar` (timers falsos)
  - `deshabilita el input de texto, el botón de enviar y el micro sin conexión` (monta `ConversationScreen` con `Avatar` sustituido por `vi.mock` y `ResizeObserver` falso)
  - `al perder la conexión thinking, listening y speaking vuelven a false en ≤ 3 s` (emite `router:routed` para poner `thinking:true` y después `source.set('closed')`)
- `companion-reducer.test.ts`: `CONNECTION_LOST resetea thinking, listening, speaking, sttLive y subtitle y conserva history`; `LISTEN_END apaga listening`.
- `health/useSystemHealth.test.tsx`: `tras 8 s sin system:health deja de comprobar y marca timedOut`; `refresh reinicia el timeout`.
- `health/useSecretsSave.test.tsx` (nuevo): `sin conexión save() pasa a error y no emite secrets:save`.

**Pasos**

1. PR1: tipos y error; test; `setState` y `onStateChange`; `send()` rechaza; exportaciones; enmienda de ADR 0013 y párrafo de architecture.md; `npm run verify`.
2. PR2 (con P-07b ya fusionado): `ConnectionProvider`, hook y banner; `main.tsx` y `App.tsx`; reducer y efecto; `ConversationScreen`; health y secrets; tests; `npm run verify`.
3. Prueba manual del agente en el PR2 (abajo) antes de fusionar.

**Criterio de hecho**

- `npm run verify` en verde con los tests nuevos.
- `git grep -n "drop .* — conexión no abierta" packages/core/src` sigue existiendo como log, y `git grep -n "TransportNotOpenError" packages/core/src` lo encuentra en `send()`.
- ADR 0013 tiene la nota de enmienda con fecha.

**Prueba manual (el agente), con `npm run dev`:**

1. Con todo arriba, parar el core-host (Ctrl+C en su terminal): en ≤ 3 s aparece el banner y el input y el micro quedan deshabilitados.
2. Volver a arrancar el core-host: el banner desaparece solo y se puede escribir.
3. Mandar un mensaje y, mientras pone «Pensando…», parar el core-host: la UI deja de «pensar».
4. Ir a Setup con el core-host parado: en ≤ 8 s sale «El core-host no responde» en lugar de «comprobando…».

**Tamaño y quién.** PR1 ≈ 180 líneas, agente (sonnet), 1 h (incluye revisar la enmienda). PR2 ≈ 290 líneas, mixto (sonnet; el agente hace la prueba manual), 2 h. **Total 3 h.** Si PR2 pasa de 300 líneas, se parte en «banner + input» y «Setup + secrets».

**Riesgos y reversión.**

- Arrancar con el input deshabilitado hasta la primera conexión puede parecer un fallo si el core-host tarda (arranque en frío con Letta). El banner explica qué pasa; si molesta, se cambia el texto, no el bloqueo (aceptado por Pipe, §2.0 B4).
- `send()` que rechaza genera un `logger.error` en el bus por cada envío perdido. Es deseable (antes era silencioso); con P-02 el log ya dice el motivo.
- Que un consumidor futuro haga `await transport.send()` sin `try/catch`. Hoy solo lo llama `EventBus` (comprobado: `event-bus.ts:62`).
- Reversión: PR2 se revierte sin tocar core. PR1 se revierte junto con la enmienda (viajan juntos).

**Depende de:** P-07b (por `App.tsx` y `ConversationScreen.tsx`) y, para que los errores se lean, P-02 PR2. **Desbloquea:** el gate 5 de F1, el chip de estado del sistema (§7 del plan, P-16b) y ADR 0033, que hereda el contrato.

### 3.13 P-03 (resto) — `scripts/sync-agents-md.mjs`, plantilla de encargo y limpieza de ramas

- **Objetivo.** Que AGENTS.md no vuelva a divergir de CLAUDE.md, que cada encargo a un agente tenga la misma forma y que el repo no tenga ramas muertas que confundan a agentes y humanos.
- **Qué cierra.** La parte de AGENTS.md de L-DOC-03 (dentro de P-03a) y L-TOOL-03 (R-234, R-235, R-236, R-237, R-238, R-219; R-217 la cierra el ADR 0029 de los otros agentes).
- **Estado (2026-11-13).** PR 1 **hecho** en el PR #137: con él queda completo P-03a. Diferencias con lo escrito abajo: el extracto son las secciones de reglas y comandos de CLAUDE.md, marcadas en dos tramos («Cuándo escribir un ADR» y de «Convenciones de Git» a «Idioma»); la cabecera fija dice además qué es el proyecto y qué leer antes, sin datos que caduquen; el script rechaza un enlace a un ancla que no exista en el extracto e ignora marcadores dentro de bloques de código; `--check` ignora solo la diferencia entre CRLF y LF; y los tests son 16. En CLAUDE.md se enlazó el plan en las reglas de PR y se quitó un dato caduco. El resto quedó **hecho** el mismo día, y con ello P-03b: la plantilla de encargo (PR 2) en el PR #138, con una viñeta en CLAUDE.md que la enlaza y la prohibición de los archivos inmutables acotada a las propuestas de self-dev; el `.gitignore` (PR 3) en el PR #139, que ancla `build/`, `models/` y `data/`, añade `/packages/core-host/data/` (donde se crea de verdad el WAL) y no toca `.claude/`; y las 80 ramas locales ya fusionadas, borradas con `git branch -d` (quedan las de los worktrees y dos sin fusionar).
- **PRs (3) y la limpieza de ramas:**
  1. `chore: genera AGENTS.md desde CLAUDE.md con scripts/sync-agents-md.mjs`
  2. `docs: plantilla de encargo para agentes en CONTRIBUTING`
  3. `chore: acota los patrones de .gitignore a la raíz` (opcional, R-219; ver §2.2 #13 sobre `.claude/`)
  4. Ramas muertas: las remotas ya están borradas (2026-11-13); las locales fusionadas las borra el agente (abajo).

**Archivos a tocar**

| PR  | Archivo                                                  | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `scripts/sync-agents-md.mjs` (nuevo)                     | Exporta `buildAgentsMd(claudeMd: string): string`. Extrae de CLAUDE.md los bloques entre `<!-- agents-md:start -->` y `<!-- agents-md:end -->` (en orden), normaliza fines de línea a LF y antepone una cabecera fija: «Generado desde CLAUDE.md por `scripts/sync-agents-md.mjs`. No editar a mano: edita CLAUDE.md y ejecuta `npm run agents:sync`». Sin marcadores, o con marcadores desparejados, lanza. CLI: sin argumentos escribe AGENTS.md; `--check` sale con 1 y un diff de las primeras líneas distintas si AGENTS.md no coincide. |
| 1   | `scripts/sync-agents-md.test.mjs` (nuevo)                | Tests con `node:test` (ver abajo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1   | `CLAUDE.md`                                              | Marcadores alrededor de las secciones que el ADR 0029 defina como extracto (reglas duras y comandos). **Qué secciones van lo decide el ADR 0029**, no este encargo.                                                                                                                                                                                                                                                                                                                                                                           |
| 1   | `AGENTS.md`                                              | Regenerado. El diff frente a la versión que dejen los agentes de documentación lo revisa un segundo agente (§2.0, A2).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1   | `package.json:13-24`                                     | `"agents:sync": "node scripts/sync-agents-md.mjs"` y `"agents:check": "node scripts/sync-agents-md.mjs --check"`; `verify` añade `&& npm run agents:check` (§2.2 #12).                                                                                                                                                                                                                                                                                                                                                                        |
| 1   | `eslint.config.js`                                       | Ya cubierto si P-04 PR2 entró antes (`'scripts/**/*.mjs'`); si no, se añade aquí.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2   | `CONTRIBUTING.md` (85 líneas; nueva sección tras `:1-7`) | «Encargar trabajo a un agente», con la plantilla: lote y hallazgos que cierra; archivos con archivo:línea; test rojo (archivo, nombres y por qué falla hoy); pasos; criterio de hecho con comandos; tamaño (≤ 300 líneas); prohibiciones fijas (no tocar inmutables de self-dev, no pushear a `develop` ni `main`, no `--no-verify`, no subir majors fuera de su lote, no tocar `.env*` ni `config/` salvo que el encargo lo diga); y «qué revisa Pipe» (la intención). Enlaza a las reglas de PR del ADR 0029 en vez de copiarlas.           |
| 3   | `.gitignore:6-7, 54, 86, 90`                             | `build/`, `models/` y `data/` pasan a `/build/`, `/models/`, `/data/` (o a las rutas concretas donde se generan: el agente lo comprueba con `git check-ignore -v` antes y después). `.claude/` (`:54`): según la respuesta de Pipe (§2.2 #13).                                                                                                                                                                                                                                                                                                |

**Tests (PR1, `scripts/sync-agents-md.test.mjs`)**

- `extrae solo los bloques marcados y en orden`
- `antepone la cabecera de archivo generado`
- `normaliza CRLF a LF` (el repo fuerza LF en `.gitattributes`, pero en Windows el archivo de trabajo puede tener CRLF)
- `lanza si no hay marcadores`
- `lanza si un marcador de inicio no tiene fin`
- `--check sale con 1 si AGENTS.md no coincide y con 0 si coincide` (con un directorio temporal)

Rojos porque el módulo no existe; cada regla se implementa contra su test.

**Atención a Prettier.** `format:check` también formatea AGENTS.md. El generador tiene que producir Markdown que Prettier deje igual: el criterio incluye `npx prettier --check AGENTS.md` tras regenerar. Si no es posible, AGENTS.md entra en `.prettierignore` con un comentario.

**Ramas remotas (ya no existen: las dos `claude/*` se borraron solas al fusionar sus PRs y las otras cuatro se borraron el 2026-11-13, parte de P-03b; la tabla queda como registro de la revisión):**

| Rama remota                             | Hallazgo | Motivo                                   |
| --------------------------------------- | -------- | ---------------------------------------- |
| `claude/shiro-design-19c4f0`            | R-234    | Fusionada (PR #97).                      |
| `claude/shiro-chibi-adr-0028`           | R-234    | Fusionada (PR #98).                      |
| `claude/project-status-Z4pDK`           | R-235    | Borraría `libc` del lock; no se rescata. |
| `chore/<usuario>/load-env-file`         | R-236    | El arreglo ya está en `develop`.         |
| `feat/<usuario>/pipeline-memory-wiring` | R-237    | Superada por el SDK de Letta.            |
| `feat/<autor>/avatar-expressions`       | R-238    | 0 commits propios.                       |

`claude/project-review-restructure-4bc57a` **no** se borra: es la de la revisión en curso.

Locales: primero `git fetch --prune` y comprobar que `develop` local está al día con `origin/develop` (hoy no lo está). Después, `git branch --merged origin/develop` y `git branch -d` (nunca `-D`) para cada una, saltando las que tenga abiertas alguno de los 8 worktrees (`git worktree list`). Lo hace el agente (§2.0, A3).

**Criterio de hecho**

- `npm run agents:check` sale con 0; si se toca una sección marcada de CLAUDE.md sin regenerar, sale con 1.
- `npm run test:scripts` incluye los 6 tests nuevos en verde.
- CONTRIBUTING tiene la plantilla y `git grep -n "Encargar trabajo a un agente" CONTRIBUTING.md` la encuentra.
- `git ls-remote --heads origin` solo muestra `main`, `develop` y las ramas con trabajo vivo.

**Tamaño y quién.** PR1 ≈ 150 líneas más el AGENTS.md regenerado, agente (sonnet), 1 h. PR2 ≈ 60 líneas, mixto (haiku redacta y un segundo agente revisa las prohibiciones), 0,5 h. PR3 ≈ 10 líneas, agente (haiku), dentro de la media hora de ramas. Ramas: agente, 0,5 h. **Total 2 h** (recortable → F2, salvo el script si Pipe quiere el gate 6 con AGENTS.md generado ya en F1).

**Riesgos y reversión.**

- Los agentes de documentación pueden dejar AGENTS.md con contenido que no sale de CLAUDE.md. Al generarlo, ese contenido desaparece: se decide en la revisión del diff si se sube a CLAUDE.md.
- Un `.gitignore` acotado puede destapar archivos que antes se ignoraban (p. ej. un `data/` local). El agente lista con `git status --ignored` antes y después y lo pone en el PR.
- Borrar una rama remota es irreversible desde GitHub si nadie la tiene en local. Por eso va de una en una, con su R-xxx.

**Depende de:** la sincronización de documentos y el ADR 0029 fusionados (los hacen otros agentes ahora); P-04 PR2 para `test:scripts`. **Desbloquea:** P-19b (F3), que amplía el check de coherencia documental, y la delegación a herramientas que solo leen AGENTS.md.

### 3.14 Cambios de docs vivos que se dejan a P-03a (no tocar ahora)

Para no pisar al grupo que sincroniza la documentación con el ADR 0029, estas líneas se corrigen en P-03a o en un PR `docs:` justo después:

- `CLAUDE.md:17` y `AGENTS.md:16,85`: «ADR 0025 (modelo de confianza local)» → ADR 0027, con el estado «2a implementada (P-05/P-06); 2b (token) pendiente».
- `README.md:598` (§Seguridad) y `docs/architecture.md:22,657-664`: lo mismo.
- `README.md:247,273`: añadir una línea sobre `LETTA_BIND`/`WHISPER_BIND` y el profile `stt` (aceptado, §2.0 B2).

### 3.15 Comprobación del gate de F1

| Punto del gate                                                                                               | Cómo se verifica                                                                                                                                                                                                    | Ítem               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1. CI verde con audit de producción y check obligatorio; suite verde en Windows; 0 tests omitidos sin motivo | `npm run verify` dos veces seguidas en Windows; job `verify` obligatorio en `develop`; `node scripts/audit-prod.mjs` sale con 0. El único omitido (`ollama-llm-live`) ya tiene su motivo anotado (tabla B, fila B4) | P-02, P-04         |
| 2. 9876, 8765 y 8283 solo en 127.0.0.1                                                                       | `netstat -ano \| findstr ":9876 :8765 :8283"` con el stack levantado. La prueba desde otro equipo de la red es opcional (D14)                                                                                       | P-05, P-06a, P-06b |
| 3. Origin ajeno 403/close, `address()` 127.0.0.1, `approved:"false"` no aprueba, tope de Whisper             | Tests de P-05 y job `whisper-limits` de P-06b en CI                                                                                                                                                                 | P-05, P-06b        |
| 4. Self-dev apagado con test                                                                                 | `wire-selfdev.test.ts` y `selfdev-default-config.test.ts`                                                                                                                                                           | P-01               |
| 5. Conexión visible y voz que no se corta                                                                    | Pruebas manuales de P-07a (parar y arrancar el core-host) y de P-07b (cambiar de pantalla con la voz sonando)                                                                                                       | P-07a, P-07b       |
| 6. AGENTS.md generado desde CLAUDE.md (si entra en F1, §2.2 #14)                                             | `npm run agents:check` sale con 0                                                                                                                                                                                   | P-03               |

**Estado (2026-11-13).** Los seis puntos se cumplen: el 6, con el PR #137. P-03b quedó hecho ese mismo día (PRs #138 y #139). De la Fase 1 queda solo P-09: sus Actions ya van fijadas por SHA (PR #140); la clave nueva con passphrase, el Environment `release` y la custodia esperan a que haya una versión que publicar (el dueño decidió el 2026-11-13 no publicar todavía).

### 3.16 Cifras de la Fase 1

| Ítem                  | PRs                   | Diff aprox.          | Quién               | Horas humanas                                   |
| --------------------- | --------------------- | -------------------- | ------------------- | ----------------------------------------------- |
| P-01 (hecho, PR #102) | 1                     | ≈ 80 líneas          | mixto               | 1,5                                             |
| P-02                  | 4                     | ≈ 155 líneas         | agente              | 2                                               |
| P-04                  | 2 + ajustes en GitHub | ≈ 280 + lock         | mixto               | 2,25                                            |
| P-05                  | 2                     | ≈ 350 + ≈ 60 del ADR | mixto (opus revisa) | 4,5                                             |
| P-06a                 | 1                     | ≈ 30 líneas          | mixto               | 2                                               |
| P-06b                 | 1                     | ≈ 250 líneas         | mixto               | 4                                               |
| P-07a                 | 2                     | ≈ 470 líneas         | mixto               | 3                                               |
| P-07b                 | 1                     | ≈ 160 líneas         | agente              | 1                                               |
| P-08                  | 1                     | ≈ 120 líneas         | agente              | 1                                               |
| P-03 (resto)          | 3 + ramas             | ≈ 220 + AGENTS.md    | mixto / humano      | 2                                               |
| **Total**             | **18 PRs**            |                      |                     | **≈ 23,25 h** (+ 3,5 h de P-03a, de otro grupo) |

Las horas coinciden con el plan de mejora salvo P-07a (+0,5 h por la enmienda de ADR 0013, que el plan no contaba) y el script de AGENTS.md (≈ 1 h que estaba dentro de P-03a).

### 3.17 Fuentes de la Fase 1 (consultadas el 2026-11-12)

- Tauri 2, referencia de configuración (`useHttpsScheme`: por defecto `http://<scheme>.localhost` en Windows): https://v2.tauri.app/reference/config/
- `ws`, documentación de `WebSocketServer` (`verifyClient` desaconsejado; `maxPayload` por defecto 100 MiB): https://github.com/websockets/ws/blob/master/doc/ws.md
- Node.js 22, `net` (`listen` sin host → `::`; `autoSelectFamily` por defecto `true` desde la v20): https://nodejs.org/docs/latest-v22.x/api/net.html · y el test runner de Node 22 en nodejs.org (`node --test` sin argumentos también busca `**/*.test.ts`).
- Docker Compose, profiles: https://docs.docker.com/compose/how-tos/profiles/
- Uvicorn, settings (`--ws-max-size` 16 MiB, host por defecto `127.0.0.1`): https://uvicorn.dev/settings/
- Registro npm (form-data 4.0.6, zod 4.6.7 y shell-quote 1.12.0 como `latest`) y aviso GHSA-hmw2-7cc7-3qxx de form-data.
- Referencia de opciones de Dependabot en docs.github.com (límite por defecto de 5 PRs por ecosistema, `cooldown`, `groups`, `multi-ecosystem-group`).
- Versión actual de la imagen `letta/letta`: **sin verificar** (no se encontró la página oficial de tags; se fija la imagen local que ya funciona).
- Contraste WCAG: cálculo propio de luminancia relativa (2026-11-12).
