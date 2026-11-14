# Plan de implementación (2026-11) — Actualización de versiones por lotes

> Parte del [plan de implementación](README.md) (estado: propuesta; V2 aprobada y escalonada el 2026-11-13, ver §2.0 del índice). Los IDs R-xxx, L-xxx y P-xx son los de la [revisión](../revision-estado-2026-11.md) y del [plan de mejora](../plan-mejora-2026-11.md). Las referencias a otras secciones (§1, §2, §7 en el índice; §3 a §6 en los archivos hermanos) están resueltas en la tabla del [índice](README.md).

## 4. Actualización de versiones por lotes

Concreta P-06a, P-06b, P-09, P-18, P-28, P-31a y P-31b del plan de mejora sin contradecirlos, propone un ítem nuevo (P-31c, migración del modelo de Claude) y añade lo que pide la decisión de hoy: actualizar por lotes pequeños con tests, con el SDK de Anthropic 1.x y el modelo de Claude incluidos. Las subidas de seguridad de producción son de **P-04** (§3.7), que es su fuente única.

Fuentes de partida: `npm outdated` y `npm audit` del 2026-11-12 (31 avisos: 5 críticos, 11 altos, 14 moderados, 1 bajo), los `package.json`, `package-lock.json`, `Cargo.toml`/`Cargo.lock`, `services/whisper/requirements.txt` y `Dockerfile`, `docker-compose.yml`, `.github/workflows/*.yml` y los `tsconfig*.json`.

### 4.1 Resumen

- **Seguridad primero (P-04, en la Fase 1):** zod 4.6.7, form-data 4.0.6 y el override de shell-quote los sube **P-04 PR1** (fuente única, §3.7). Aquí no se repiten.
- **Parches dentro de rango (V1, después de P-04 PR1):** `@yao-pkg/pkg`, `concurrently`, `ws`, `yaml`, `@letta-ai/letta-client` y las transitivas que `npm audit fix` resuelve sin `--force`, en dos PR pequeños. Lo que queda después es **solo de desarrollo** (vitest 2, vite 5, esbuild y compañía).
- **Herramientas de desarrollo (V2):** **aprobada por Pipe el 2026-11-13 y escalonada**: V2a (menores, P-44) ya; V2b (TypeScript 6, P-45) al acabar la Fase 1; V2c (vite 8 y después vitest 5, P-46 y P-47) tras P-28; V2d (ESLint 10, P-48) al final. El plan de mejora ya recoge estos ítems y corrige §12, la fila P-31b y la nota de P-28. V2c va obligatoriamente en dos PR. TypeScript 7 y React 19 siguen fuera.
- **SDK de Anthropic y modelo (V3):** esperan a los tests del loop de tools, en la Fase 4 (decidido el 2026-11-13). Orden P-30 → V3a (= P-31a) → P-32 → V3b (= P-31c; Pipe autoriza el cambio a `claude-sonnet-5-5` cuando toque). V3a sube el SDK de 0.39 a 1.x **sin cambiar de modelo** y solo quita `temperature` (la API `2026-10-21` que envía el SDK 1.0 lo rechaza) y ajusta tipos. El manejo de `refusal` y `max_tokens` es de P-32. V3b cambia `claude-sonnet-4-6` → `claude-sonnet-5-5`: el `tool_choice` forzado devuelve 400, así que `{text, emotion}` pasa a `output_config.format` (enmienda de ADR 0014 y la **única** enmienda de ADR 0022). Effort propuesto: **`low`** en conversación.
- **Tauri y Rust (V4 = parte de P-31b):** Tauri 2.11 → 2.12 en bloque (crates + `@tauri-apps/*`) y Rust fijado con `rust-toolchain.toml` en vez de `stable` flotante.
- **Servicios, imágenes y Actions (V5 = P-06a, P-06b, P-18, P-09, P-28):** Letta por digest (P-06a), base CUDA por digest (P-06b), `ctranslate2` fijado, Actions por SHA y Node 22 fijado.
- **No se toca:** pixi 7 / lipsyncpatch / Cubism 4.2.2 (ADR 0021), React 18, TypeScript 7, `@types/node` > 22, la base CUDA (salvo fijarla), better-sqlite3 13 (queda como opción, ver §4.4).

### 4.2 Inventario

Riesgo: B = bajo, M = medio, A = alto. «Salto»: parche, menor o mayor (en 0.x, un menor cuenta como mayor).

| Componente                                                                                                                                | Actual                                           | Destino                                               | Salto        | Riesgo | Lote                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- | ------------ | ------ | ----------------------------------------------- |
| zod (prod, core)                                                                                                                          | 4.4.3                                            | 4.6.7                                                 | menor        | B      | P-04 PR1                                        |
| shell-quote (override raíz)                                                                                                               | `^1.8.4`                                         | `^1.11.0`                                             | menor        | B      | P-04 PR1                                        |
| form-data (transitiva de producción)                                                                                                      | 4.0.5                                            | 4.0.6                                                 | parche       | B      | P-04 PR1                                        |
| resto de transitivas de producción y dev (tar, undici, js-yaml, postcss, nanoid, brace-expansion, qs, glob, browserslist, source-map-js…) | varias                                           | lo que `npm audit fix` dé sin `--force`               | parche/menor | B      | V1b                                             |
| @yao-pkg/pkg                                                                                                                              | 6.20.0                                           | 6.25.0                                                | menor        | B      | V1a                                             |
| concurrently                                                                                                                              | 9.2.1                                            | 9.2.5                                                 | parche       | B      | V1a                                             |
| ws / @types/ws                                                                                                                            | 8.21.0 / 8.18.1                                  | 8.22.2 / 8.18.2                                       | menor        | B      | V1a                                             |
| yaml                                                                                                                                      | 2.9.0                                            | 2.9.1                                                 | parche       | B      | V1a                                             |
| @letta-ai/letta-client                                                                                                                    | 1.12.0                                           | 1.12.1                                                | parche       | B      | V1a                                             |
| prettier                                                                                                                                  | 3.8.3                                            | 3.10.0                                                | menor        | B      | V2a                                             |
| eslint (9.x) / typescript-eslint                                                                                                          | 9.39.4 / 8.59.4                                  | 9.39.5 / 8.72.2                                       | parche/menor | B      | V2a                                             |
| tsx                                                                                                                                       | 4.22.3                                           | 4.23.15                                               | menor        | B      | V2a                                             |
| @types/node                                                                                                                               | 22.19.19                                         | 22.20.5 (se queda en la línea 22)                     | parche       | B      | V2a                                             |
| @types/react, @testing-library/\* (react, user-event)                                                                                     | 18.3.29 / 16.3.2 / 14.6.1                        | 18.3.31 / 16.3.3 / 14.6.10                            | parche       | B      | V2a                                             |
| @fontsource/\* (5)                                                                                                                        | 5.2.x                                            | 5.3.0                                                 | menor        | B      | V2a                                             |
| typescript                                                                                                                                | 5.9.3                                            | 6.0.x                                                 | mayor        | M      | V2b (P-45)                                      |
| vite + @vitejs/plugin-react                                                                                                               | 5.4.21 + 4.7.0                                   | 8.3.x + 6.3.x                                         | mayor ×3     | A      | V2c-1 (P-46)                                    |
| vitest + @vitest/coverage-v8                                                                                                              | 2.1.9                                            | 5.1.0                                                 | mayor ×3     | A      | V2c-2 (P-47)                                    |
| eslint + eslint-config-prettier + eslint-plugin-react-hooks + eslint-plugin-react-refresh                                                 | 9 / 9 / 5 / 0.4                                  | 10.14 / 10.1 / 7.1 / 0.5                              | mayor        | M      | V2d (P-48)                                      |
| @testing-library/jest-dom                                                                                                                 | 6.9.1                                            | 7.0.1                                                 | mayor        | M      | V2d (o cola)                                    |
| @vercel/ncc                                                                                                                               | 0.38.4                                           | 0.45.0                                                | mayor (0.x)  | M      | V4 (toca el sidecar)                            |
| @anthropic-ai/sdk                                                                                                                         | 0.39.0                                           | 1.x (1.8.0 el 12-nov)                                 | mayor        | A      | V3a                                             |
| Modelo cloud                                                                                                                              | `claude-sonnet-4-6`                              | `claude-sonnet-5-5`                                   | modelo       | A      | V3b                                             |
| tauri / tauri-build (crates)                                                                                                              | 2.11.2 / 2.6.2 (lock)                            | última 2.12.x / su par                                | menor        | M      | V4                                              |
| plugins Rust (updater, process, log, fs, shell, dialog…)                                                                                  | 2.3–2.10 (lock)                                  | últimas 2.x                                           | menor        | M      | V4                                              |
| @tauri-apps/cli / plugin-updater / plugin-process                                                                                         | 2.11.2 / 2.10.1 / 2.3.1                          | 2.12.4 / 2.14.1 / 2.4.0                               | menor        | M      | V4                                              |
| Rust                                                                                                                                      | `stable` flotante en CI, `rust-version = "1.77"` | toolchain fijado (versión exacta, sin verificar cuál) | —            | M      | V4                                              |
| Imagen Letta                                                                                                                              | `letta/letta:latest`                             | digest de la imagen que funciona hoy                  | fijar        | M      | V5a (P-06a)                                     |
| Base CUDA de Whisper                                                                                                                      | `nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04`   | misma, por digest                                     | fijar        | B      | P-06b (reescribe `services/whisper/Dockerfile`) |
| faster-whisper                                                                                                                            | 1.1.1                                            | 1.2.1                                                 | menor        | M      | V5b (P-18)                                      |
| ctranslate2                                                                                                                               | sin fijar (transitiva)                           | 4.x fijada, compatible con cuDNN 9 de la base         | fijar        | M      | V5b (P-18)                                      |
| fastapi / uvicorn / websockets / numpy / pytest…                                                                                          | fijadas a finales de 2024                        | sin verificar; subir dentro de su major con pip-audit | menor        | B      | V5b (P-18)                                      |
| actions/checkout                                                                                                                          | `@v4`                                            | v7.0.1 por SHA                                        | mayor        | B      | V5c (P-09)                                      |
| actions/setup-node                                                                                                                        | `@v4`                                            | v7.1.0 por SHA                                        | mayor        | B      | V5c (P-09)                                      |
| dtolnay/rust-toolchain, swatinem/rust-cache, tauri-apps/tauri-action                                                                      | `@stable`, `@v2`, `@v0`                          | por SHA                                               | fijar        | B      | V5c (P-09)                                      |
| Node                                                                                                                                      | `engines >=20`, CI `'22'`                        | 22 fijado (`engines`, `.node-version`)                | fijar        | B      | V5c (P-28)                                      |
| pixi.js / pixi-live2d-display-lipsyncpatch / @pixi/unsafe-eval                                                                            | 7.4.3 / 0.5.0-ls-8                               | **mismas, exactas**                                   | —            | —      | P-31b (solo fijar)                              |
| react / react-dom / @types/react\*                                                                                                        | 18.3                                             | **se queda**                                          | —            | —      | no                                              |
| better-sqlite3 / @types                                                                                                                   | 11.10.0 / 7.6.13                                 | **se queda** (opción 13.x en §4.4)                    | —            | —      | no                                              |

### 4.3 Lotes en orden

Reglas comunes a todos los lotes:

- Un PR por fila, base `develop`, con el prefijo de commit indicado. Antes de pedir revisión: `npm run verify`. Cuenta para el límite de 2 PRs de agente abiertos.
- El `package-lock.json` se regenera con `npm install` en el mismo PR. Nunca `npm audit fix --force`.
- Reversión por defecto: `git revert` del commit de merge y `npm ci`. Ningún lote cambia datos persistentes salvo donde se dice.
- Prueba manual de Pipe solo donde hay I/O real (voz, memoria, binario), por la regla «pedir al usuario que pruebe antes de declarar hecho».

#### V1 — Parches dentro de su rango (después de P-04 PR1)

Las subidas de seguridad (zod `^4.6.7` en `packages/core/package.json:29`, form-data 4.0.6 y el override de shell-quote) las hace **P-04 PR1** (§3.7), que es la fuente única y no lleva `npm audit fix` general. V1 es el lote posterior con el resto, partido en dos PR para que cada diff se pueda revisar:

- **V1a** `chore: parchea dependencias directas dentro de su rango`: `concurrently` 9.2.5, `@yao-pkg/pkg` 6.25.0, `ws`/`@types/ws`, `yaml` 2.9.1 y `@letta-ai/letta-client` 1.12.1. Diff de `package.json` de pocas líneas más el lock.
- **V1b** `chore: parchea dependencias transitivas con npm audit fix`: `npm audit fix` (nunca `--force`) para las transitivas marcadas `fix: true`: tar, undici, js-yaml, postcss, nanoid, brace-expansion, qs, glob, browserslist, source-map-js, baseline-browser-mapping y las `@typescript-eslint/*`. Solo cambia el lock: el PR lleva la lista de paquetes y versiones (antes → después) para que Pipe revise eso y no el lock línea a línea.

Notas:

- Tras P-04 PR1, `npm audit --omit=dev` ya debería quedar sin high ni critical. Lo que siga en el audit completo es dev (vitest, coverage-v8, vite-node, @vitest/mocker, tinypool, vite, esbuild, minimatch, test-exclude): solo lo cierra V2c (P-46 y P-47).
- Cambios incompatibles: ninguno esperado. `@letta-ai/letta-client` 1.12.1 es parche, pero toca la memoria: prueba manual de un turno con memoria.

Tests y prueba manual: suite completa (`npm run verify`). Pipe arranca `npm run dev` una vez, manda un turno y comprueba que se recuerda al recargar.

#### V2 — Herramientas de desarrollo (aprobada el 2026-11-13, escalonada)

Pipe aprobó el 2026-11-13 los saltos mayores de tooling, escalonados. El plan de mejora los recoge como ítems con su fase y ya no los contradice: §12 deja de descartar vitest, vite, TypeScript 6 y ESLint 10 (sigue descartando React 19, pixi 8, TypeScript 7 y better-sqlite3 13), la fila P-31b deja de decir «vitest con vite dentro de su major» y la nota de P-28 limita `test.projects` hasta V2c.

| Orden | Lote          | Ítem        | Cuándo                                                           |
| ----- | ------------- | ----------- | ---------------------------------------------------------------- |
| 1     | V2a           | P-44        | Ya (Fase 1, recortable), tras P-04 PR2                           |
| 2     | V2b           | P-45        | Al acabar la Fase 1                                              |
| 3     | V2c-1 y V2c-2 | P-46 y P-47 | Después de P-28 (Windows en CI, Fase 2); en dos PR, vite primero |
| 4     | V2d           | P-48        | Al final                                                         |

**V2c va después de P-28** (job Windows en CI), por el mismo motivo que da el plan: sin Windows en CI, un salto de vitest/vite es a ciegas para el sidecar y el binario.

##### V2a — Menores de tooling

**Hecho (2026-11-13).** Entró por los PRs de Dependabot #129 (prettier 3.9.10, typescript-eslint 8.72.1, tsx, `@types/node`, testing-library, y también `@vercel/ncc` 0.45 y `@yao-pkg/pkg` 6.25, con el sidecar construido y arrancado) y #130 (`@fontsource/*`, entre otras de producción), y por el PR #132 (eslint 9.39.5, `@types/react` y transitivas con avisos). Prettier 3.9 cambió el formato de las uniones de tipos cortas: el reformateo fue en el mismo PR. Quedan por debajo del inventario, porque sus versiones tenían menos de 7 días: prettier 3.10, typescript-eslint 8.72.2 y `@testing-library/user-event` 14.6.10; y con avisos abiertos por el mismo motivo, `brace-expansion` y `tar`. Los propondrá Dependabot al pasar el margen.

PR `chore: actualiza herramientas de desarrollo dentro de su major`. Sube las filas «V2a» del inventario. Riesgo bajo. Prettier 3.10 puede reformatear algún archivo: el PR incluye `npm run format` y se revisa que el diff sea solo formato. `@types/node` se queda en `^22` (no 26: el runtime es Node 22, ver V5c).

##### V2b — TypeScript 6.0

PR `chore: actualiza TypeScript a 6.0`. TypeScript 6.0 salió el 23-mar-2026; trae los cambios incompatibles que TypeScript 7 convierte en errores, así que es el paso previo obligado.

Cambios que afectan al repo (guía oficial de 6.0):

| Cambio en 6.0                                                         | Dónde afecta                                                                                                                                            | Acción                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `types` pasa a `[]` por defecto: `@types/node` deja de incluirse solo | `tsconfig.base.json` no fija `types`; `packages/core/tsconfig.json` y `packages/core-host/tsconfig.json` heredan sin `types` (usan `process`, `node:*`) | Añadir `"types": ["node"]` en esos dos `tsconfig.json` (o en la base, y el desktop ya lo sobrescribe con `["vite/client", "node"]`) |
| `rootDir` por defecto = carpeta del tsconfig                          | `tsconfig.build.json` de core y core-host ya fijan `"rootDir": "./src"`                                                                                 | Nada; comprobar que `dist/index.js` sigue en su sitio                                                                               |
| `noUncheckedSideEffectImports` = `true`                               | imports de efecto (`@fontsource/*` en el desktop)                                                                                                       | Si falla, revisar que existen; no desactivar sin motivo                                                                             |
| `esModuleInterop: false` prohibido                                    | ya es `true` en la base                                                                                                                                 | Nada                                                                                                                                |
| `dom.iterable` dentro de `dom`                                        | `packages/desktop/tsconfig.json` lista `DOM.Iterable`                                                                                                   | Se puede dejar; quitarlo es cosmético                                                                                               |

Requisito: `typescript-eslint` 8.72 debe aceptar TS 6 (sin verificar el rango exacto de su `peerDependencies`; se ve en el `npm install`). Tests: typecheck de los tres paquetes, build de core y core-host, `build:sidecar` en local.

##### V2c — vite 8 + plugin-react 6, y después vitest 5 + coverage-v8 5 (cierra R-035)

Son tres mayores con umbrales de cobertura que pueden moverse: no es un lote pequeño, así que va **obligatoriamente en dos PR**. vitest 5 exige **vite ≥ 6.4** y **Node ≥ 22.12** (guía de migración de vitest, consultada el 12-nov).

- **V2c-1** `chore: actualiza vite a 8 y plugin-react a 6`: con el vitest actual. Si el proyecto de tests del desktop no arranca con el plugin nuevo bajo vitest 2, el paso intermedio es vitest 3.2 (último que acepta vite 5-7; compatibilidad **sin verificar**) dentro de este mismo PR, y se dice en la descripción.
- **V2c-2** `chore: actualiza vitest y coverage-v8 a 5`: con V2c-1 ya en `develop`.

Cambios que afectan al repo:

- **Workspace de vitest:** en vitest 4 desaparece el archivo de workspace y `defineWorkspace`. `vitest.workspace.ts:4-10` se mueve a `test.projects` en un `vitest.config.ts` raíz con las tres rutas. Esto **concreta** P-28: su restricción «nada de `test.projects` mientras vitest siga en 2.x» deja de aplicar en cuanto se haga V2c; si P-28 ya está hecho, su job de cobertura cambia `--project core` solo si el nombre del proyecto cambia (hoy `name: 'core'` en `packages/core/vitest.config.ts:5`, se mantiene).
- **Cobertura v8:** `coverage.all` y `experimentalAstAwareRemapping` desaparecen (el repo no los usa); el remapeo por AST es el único y **puede mover los porcentajes**. Los umbrales 80/80/75/80 (`packages/core/vitest.config.ts:14-19`) pueden fallar sin cambiar código: si caen, se anota la cifra nueva y se decide en el PR, no se bajan a ciegas. En vitest 5, `coverage.include` es relativo a la raíz del proyecto (`include: ['src/**/*.ts']`, línea 12: ya lo es).
- **Mocks:** vitest 5 activa `clearMocks: true` por defecto; vitest 4 hace que un mock llamado con `new` construya instancias (las implementaciones con flecha fallan con «not a constructor») y cambia `vi.restoreAllMocks`. Los tests que mockean el cliente de Anthropic (`packages/core/tests/unit/modules/llm/anthropic-llm.test.ts`) y los de timers falsos son los candidatos a romper.
- **jsdom:** las asignaciones a `window`/`globalThis` se propagan al DOM (vitest 5); afecta a tests que stubbean `matchMedia` o `Audio` en el desktop.
- **vite 8:** Rolldown y Oxc sustituyen a esbuild y Rollup; `build.rollupOptions` pasa a `rolldownOptions` (el `vite.config.ts` del desktop no lo usa, sin verificar el resto del archivo), y el target mínimo sube a Chrome 111, sin impacto en WebView2. El import `?url` del AudioWorklet (`pcm-capture-processor.js`) y la carga de Live2D/pixi son los dos puntos a probar a mano.

Tests y prueba manual: suite completa, `npm run test:coverage`, `npm run build`; Pipe arranca `npm run dev`, habla una frase (AudioWorklet), ve el avatar cargar y `npm run tauri:build` (Rust ya está instalado en el portátil).

Reversión: revert del PR; ningún dato afectado.

##### V2d — ESLint 10 y plugins

PR `chore: actualiza ESLint a 10`. ESLint 10 exige Node 20.19+, 22.13+ o 24+; busca `eslint.config.*` desde la carpeta de cada archivo (el repo tiene uno solo en la raíz: sin efecto) y activa tres reglas nuevas en `recommended` (`no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error`). `eslint-plugin-react-hooks` 5 → 7 trae reglas nuevas (sin verificar cuántas avisan): si hay muchas, el PR las deja en `warn` y abre una tarea. `eslint-config-prettier` 9 → 10 y `react-refresh` 0.5 en el mismo PR. `@testing-library/jest-dom` 7 puede ir aquí o a la cola.

#### V3 — SDK de Anthropic 1.x y modelo de Claude (dos PR)

Fuentes: la guía de migración de modelos y la de la versión de API `2026-10-21` incluidas con la herramienta (leídas el 12-nov-2026) y la guía pública `platform.claude.com/docs/en/api/migration-2026-10-21` (sección TypeScript, consultada el mismo día).

Precios (por millón de tokens, entrada/salida): `claude-sonnet-4-6` 3/15 USD; `claude-sonnet-5-5` 2/10 USD (lecturas de caché 0,10); `claude-haiku-5-5` 0,10/0,50 USD con prompts ≤ 100K tokens. Sonnet 5.5 usa el tokenizador de Sonnet 5: el mismo texto cuenta **~30 % más tokens** que en 4.6. Ejemplo orientativo de un turno de 3.000 tokens de entrada y 200 de salida (en el tokenizador de 4.6): 4.6 ≈ 0,012 USD; 5.5 ≈ 3.900 × 2 + 260 × 10 por millón ≈ 0,010 USD más el pensamiento que haga (casi nulo en `low`); Haiku 5.5 ≈ 0,0005 USD.

##### V3a — SDK 0.39 → 1.x, mismo modelo (= P-31a)

PR `chore: actualiza @anthropic-ai/sdk a 1.x`. Requisito del plan: P-30 en verde antes (tests de la rama tool-use con LLM fake). Alcance: **solo el SDK** (como pide la fila P-31a): quitar `temperature` y ajustar tipos. Nada de cambiar el loop.

Orden de los PR que tocan `anthropic-llm.ts`: **P-30 → V3a (P-31a) → P-32 → V3b**. Así cada uno toca el bloque `:198-284` una vez y con el anterior ya fusionado.

Qué rompe en este código:

| Qué                                    | Dónde                                                                                           | Por qué                                                                                                                                                                                                      | Cambio                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temperature`                          | `anthropic-llm.ts:52` (esquema, default 1.0), `:171` (`generate`), `:228` (`generateWithTools`) | El SDK 1.0.0 envía `anthropic-version: 2026-10-21`, que devuelve **400 con `temperature`, `top_p` o `top_k` aunque valgan el default**, en cualquier modelo. El SDK 1.x ya no tiene esos campos en sus tipos | Quitar el campo de las dos llamadas y del esquema zod. `config/modules.config.yaml:22-27` no fija `temperature` (usa el default 1.0), así que **no se pierde nada**: no hay valor no-default que decidir |
| Tests de `temperature`                 | `anthropic-llm.test.ts:49,55-60,63-65`                                                          | Asertan el campo eliminado                                                                                                                                                                                   | Sustituir por aserciones sobre `max_tokens` y `model`                                                                                                                                                    |
| `MessageParam` pasa a unión por rol    | `anthropic-llm.ts:219` (`Anthropic.MessageParam[]`), `:264` y `:275` (`push` con `role`)        | En 1.x es `UserMessageParam \| AssistantMessageParam \| SystemMessageParam`                                                                                                                                  | Los literales con `role` siguen compilando; solo revisar el typecheck                                                                                                                                    |
| La clave va en `Authorization: Bearer` | `anthropic-llm.ts:152` (`new Anthropic({ apiKey })`)                                            | Cambio del SDK 1.x                                                                                                                                                                                           | Sin proxy ni gateway: nada. Si algún test stubbea `X-Api-Key`, se cambia                                                                                                                                 |
| Un cliente, una credencial             | idem                                                                                            | Pasar dos credenciales lanza `TypeError`                                                                                                                                                                     | Se pasa solo `apiKey`: nada                                                                                                                                                                              |
| Licencia                               | —                                                                                               | El SDK 1.x es Apache 2.0 (antes MIT)                                                                                                                                                                         | Anotarlo en NOTICE/LICENSE de terceros si P-20 lo lleva                                                                                                                                                  |
| form-data sale de producción           | `package-lock.json:5334`                                                                        | La traía el SDK 0.x                                                                                                                                                                                          | Nada que borrar: P-04 PR1 la parchea a 4.0.6 sin excepción                                                                                                                                               |

Tests: los de `anthropic-llm.test.ts` actualizados (sin `temperature`). Prueba manual (la de P-31a): un turno normal, `fs:read`, `fs:write` con aprobación y una propuesta de self-dev. Coste de la prueba: unos céntimos, con la key de Anthropic para pruebas, que ya está disponible (los créditos de API están enlazados a una organización de Console).

Reversión: revert; el lockfile vuelve a 0.39.

##### Lo que pasa a P-32 (tool-loop honesto, F4)

Estos dos arreglos son independientes del SDK y del modelo (Sonnet 4.6 también puede devolver `refusal`), así que se encargan a **P-32**, que ya cubre «truncados» en el tool-loop:

- **`stop_reason: "refusal"`:** hoy no se trata. En `generate` (`anthropic-llm.ts:181`) acaba en `extractToolUse` → texto vacío y `neutral` (Shiro «responde» en silencio). En el loop (`:247-261`) devuelve `''`. Rama explícita antes de leer `content`: log con `stop_details.category`, respuesta en personaje («Eso no puedo hacerlo») y emoción neutral. Ramificar por `stop_reason`, nunca por `stop_details` (puede ser `null`).
- **No ejecutar tools de una respuesta truncada o rechazada:** el loop solo avisa con `max_tokens` (`:241-245`) y después ejecuta los `tool_use` igualmente (`:263-275`). Con `fs:write` eso puede escribir un archivo a medias tras la aprobación. Si `stop_reason` es `max_tokens` o `refusal`, no se ejecuta ninguna tool de esa vuelta.
- Tests en P-32: refusal en `generate`, refusal y `max_tokens` en el loop sin llamar a `executeTool`.
- La regla se documenta en la **única enmienda de ADR 0022**, que va en V3b (P-31c). Si P-31c se recorta, esa enmienda viaja con P-32.

##### V3b — `claude-sonnet-4-6` → `claude-sonnet-5-5` (= P-31c, Fase 4)

PR `feat: migra el LLM cloud a Claude Sonnet 5.5 (incluye enmiendas ADR 0014 y 0022)`. Va después de V3a y de P-32, con P-30 en verde. Pipe autorizó el 2026-11-13 el cambio de modelo a `claude-sonnet-5-5` cuando toque; el ítem P-31c ya está en la Fase 4 del plan de mejora. Se pasa por Sonnet 5 en papel: de 4.6 a 5.5 se aplican los cambios de Sonnet 5 y los de 5.5 encima.

Qué rompe exactamente en este código:

1. **`tool_choice` forzado → 400.** Sonnet 5.5 rechaza `{type: 'tool'}` y `{type: 'any'}` («tool_choice: type "tool" and "any" are not supported for this model»), también en `count_tokens`.
   - `generate`: `tool_choice: { type: 'tool', name: 'respond' }` en `anthropic-llm.ts:175` (y el test `anthropic-llm.test.ts:105-127`). Es el mecanismo de ADR 0014 (`docs/adr/0014-llm-structured-output-text-emotion.md:51-66`).
   - `generateWithTools`: `tool_choice: { type: 'any' }` en `:232`. Lo usan la conversación con tools (`packages/core-host/src/pipeline/conversation-flow.ts:212`) y el self-dev (`packages/core-host/src/selfdev/wire-selfdev.ts:186-198`). `tool-loop.ts` no llama a la API: no cambia, salvo lo de §«effort» abajo.
2. **Salida estructurada `{text, emotion}`:** se sustituye la tool `respond` forzada por **structured outputs** (`output_config.format` con JSON Schema; en TS `client.messages.parse` + `zodOutputFormat`, o el esquema a mano). En `generate` es directo: el mismo esquema de `buildResponseToolSchema()` (`:91-104`) con `additionalProperties: false`. Ventaja medible: ADR 0014 (`:111`) anota que ~30 % de las respuestas triviales llegaban sin `emotion` porque `required` era solo una pista; con structured outputs el esquema se garantiza.
   - En el loop hay dos opciones; **recomiendo la B**:
     - A) mantener `respond` como tool terminal con `strict: true` y `tool_choice` auto, pedir en el system prompt que la llame para terminar y, si la vuelta acaba sin `respond`, tratar el texto como respuesta (ya existe la degradación de `:257-261`). Cambio mínimo, pero `auto` no garantiza la llamada.
     - B) quitar `respond` del loop: tools reales con `strict: true` y `auto`, y `output_config.format` con `{text, emotion}` para la respuesta final. Un solo mecanismo para `generate` y el loop. Hay que probar con llamadas reales que el modelo llama a la tool antes de escribir el JSON (la guía advierte de que, con pensamiento apagado, puede saltarse la tool cuando hay formato JSON; con pensamiento adaptativo no aplica).
   - `strict: true` exige `additionalProperties: false` en los `inputSchema` de las tools (`fs`, `shell`, `selfdev`): hay que revisarlos en `packages/core/src/modules/tools/`.
3. **`temperature`:** ya eliminado en V3a. Sonnet 5.x rechaza valores no-default incluso con la API antigua. **Enmienda de ADR 0022 (la única de toda la cadena):** loop con `auto` + `strict` + formato estructurado, más la regla de P-32 «no ejecutar tools si `stop_reason` es `max_tokens` o `refusal`».
4. **Pensamiento (thinking):** en 4.6, sin campo `thinking`, no se pensaba; en Sonnet 5.5, omitirlo activa **pensamiento adaptativo**, y `{type: 'disabled'}` devuelve 400. Lo mínimo para «apagarlo» es `{type: 'between_tools'}` (solo con effort `high` o menor, solo en Sonnet 5.5, y sin cambiar effort a mitad de conversación). Consecuencias en el código:
   - Las respuestas pueden empezar con bloques `thinking` (texto vacío por defecto, `display: "omitted"`). El código ya lee por tipo (`:247-250`, `:317-325`): bien. **No** leer `content[0]`.
   - En el loop, los bloques `thinking` deben volver **sin tocar** con el turno del asistente: `:264` ya hace `push({ role: 'assistant', content: response.content })`. Bien. La conversación del loop es solo-añadir y el `system`/`tools` no cambian dentro del turno, así que la comprobación de «historial editado» no salta. Cada turno de Shiro empieza con un único mensaje de usuario (`:219`): no se reenvían bloques de turnos anteriores.
   - Si algún día un reintento manda el mismo cuerpo a otro modelo (p. ej. un fallback), hay que quitar `between_tools`, que otros modelos rechazan. El fallback actual va al LLM **local** con otra llamada (`conversation-flow.ts:231-233`), así que no aplica.
   - **Latencia para voz:** desde `medium`, el modelo piensa brevemente antes de casi cualquier respuesta, incluso un saludo, y eso retrasa el primer token; pedirle en el prompt que piense menos casi no tiene efecto. En `low` se salta el pensamiento en la mayoría de peticiones simples. Hoy el turno no es streaming (`messages.create`), así que lo que cuenta es la latencia total del turno, que P-16 debe medir (p50 y p95) antes y después.
5. **effort:** el default de Sonnet 5.5 es `high` y los niveles están recalibrados (no equivalen a los de Sonnet 5). **Propuesta: `low` para el turno de conversación por voz** (`generate` y el loop de conversación con tools), que es lo que la guía recomienda para chat, con pensamiento adaptativo. Si `low` sigue siendo lento, probar `between_tools` con effort `low`. Para el self-dev, `medium` (la guía lo da como punto de partida para código agéntico y avisa de que en `low` a veces se da un cambio por hecho sin verificarlo). Se añade `effort` al esquema zod de `AnthropicLLMConfigSchema` (`:43-58`) y a `GenerateWithToolsOptions` para que el self-dev lo sobrescriba, igual que hoy hace con `maxTokens` (`wire-selfdev.ts:197`). Cambiar el effort de nivel superior entre peticiones invalida la caché de prompt: con un valor fijo por ruta no pasa.
6. **`max_tokens`:** el pensamiento cuenta dentro de `max_tokens` y el tokenizador nuevo cuenta ~30 % más. El 1024 actual (`modules.config.yaml:27`, default en `:50`) puede cortar respuestas o dejar un `fs:write` truncado (ya pasa hoy, `:238-245`). Propuesta: 4096 en conversación (es un tope, no un coste), 8192 en el loop con tools y mantener 16.384 en self-dev (`selfdev-tools.ts:60`); la guía sugiere hasta 64.000 para turnos largos de código, pero un `messages.create` no streaming con un tope muy alto puede chocar con el límite de tiempo del SDK (sin verificar en 1.x), así que subirlo va con streaming en otro PR.
7. **`stop_reason: "refusal"`:** Sonnet 5.5 rechaza en cinco categorías (`cyber`, `bio`, `frontier_llm`, `reasoning_extraction`, `general_harms`); la rama añadida en P-32 lo cubre. Riesgo real para Shiro: `shell:exec` o el self-dev pueden rozar `cyber`. Nota de diseño: hoy un rechazo **no** cae al LLM local (no es una excepción; ver `conversation-flow.ts:229-234`); si Pipe quiere que Shiro conteste en local cuando la nube rechaza, es un cambio de comportamiento (§2.3 #23).
8. **`fallbacks` (servidor):** `fallbacks: "default"` con la beta `server-side-fallback-2026-07-01` reintenta en Sonnet 5 solo los rechazos `cyber` y `frontier_llm`; exige `client.beta.messages`. **No en este PR**: añade otra beta y otro modelo, y el caso de uso no lo pide. Se reevalúa si los logs muestran rechazos `cyber` en `shell:exec`. Con Haiku 5.5 **no** se envía `fallbacks` (no tiene; una lista devuelve 400).
9. **Prefill:** no se usa (no hay turno final de asistente). Nada.
10. **Computer use, advisor:** no se usan. Nada.

Archivos que cambian: `anthropic-llm.ts` (`:48` default de modelo, `:43-58` esquema, `:157-188` `generate`, `:198-284` loop), `ILLMModule.ts:71` (opción `effort`), `config/modules.config.yaml:25,27`, `wire-selfdev.ts:197`, los esquemas de tools si falta `additionalProperties: false`, y sus tests. El test de integración `bootstrap.test.ts:126` solo comprueba el prefijo `llm:anthropic:` y no cambia.

Tests: unitarios con mock (sin `tool_choice` forzado, con `output_config.format`, con bloques `thinking` delante del texto, con `refusal`, con `max_tokens` en mitad de un `tool_use`), y la suite de P-30. Prueba manual de Pipe: 10 turnos de voz anotando latencia (antes y después, misma frase), `fs:read`, `fs:write` aprobado y cancelado, una propuesta de self-dev, y revisar que las emociones llegan (que el avatar y el TTS cambian).

Reversión: el modelo y el effort son config: volver a `claude-sonnet-4-6` en `modules.config.yaml` **no basta**, porque el código ya no fuerza la tool; con structured outputs, Sonnet 4.6 también funciona (lo soporta), así que la reversión de modelo es de config y la de mecanismo es `git revert`.

Sobre `claude-haiku-5-5` como alternativa barata:

- **Clasificador del router:** hoy es local (`classifier_model: 'qwen2.5:3b'`, `modules.config.yaml:36`). Pasarlo a Haiku costaría ~0,0005 USD por turno pero mandaría **cada** mensaje a la nube (privacidad) y añadiría la latencia de red antes de cada respuesta. No se propone en este plan; es una decisión de Pipe (§2.3 #24) y, si se hace, un ADR que enmiende 0015.
- **Respuestas cortas:** Haiku 5.5 acepta `tool_choice` forzado (pero entonces no piensa), rechaza `temperature` no-default y prefill, piensa por defecto (effort por defecto `medium`; para chat, `low`) y no tiene `fallbacks`. Si se quiere un tercer nivel «cloud barato», el mismo `AnthropicLLM` sirve con otra config, pero el `HybridRouter` es binario (local|cloud): añadir un nivel es un cambio de ADR 0015.

#### V4 — Tauri y Rust (concreta la parte Tauri de P-31b)

PR `chore: actualiza Tauri en bloque y fija la toolchain de Rust`.

**Hecho en parte (2026-11-13, PR #126).** Tauri subió a 2.12 en bloque (crates y paquetes JS), con `zip` 9.4.1 y `rustls` 0.23.46, porque las alertas de Dependabot marcaban `zip` 4.6.1 con un aviso critical y otro high; `npm audit` no ve el lado Rust. El binario se compiló y se probó en local. De este lote quedan tres cosas: fijar la toolchain de Rust con `rust-toolchain.toml`; `@vercel/ncc`, que ahora llega por el grupo `sidecar` de Dependabot; y la prueba de actualización real, que va con la release de P-09. El inventario de arriba conserva las versiones de partida. La revisión de ese PR dejó tres apuntes para P-09 que ya existían antes: al instalar una actualización en Windows el updater termina el proceso sin matar el sidecar; conviene activar `requireSignedVersion` en la configuración del updater; y el log de la app rota a los 40 KB borrando el anterior.

Qué sube:

- Crates: `cargo update` dentro de `2` para `tauri`, `tauri-build` y todos los `tauri-plugin-*` (`Cargo.toml:19-49`). En el lock hoy: tauri 2.11.2, updater 2.10.1, process 2.3.1. La release `tauri@2.12.0` es del 26-sep-2026 (página oficial de releases).
- npm: `@tauri-apps/cli` 2.12.4, `plugin-updater` 2.14.1 y `plugin-process` 2.4.0, para que JS y Rust del mismo plugin vayan en la misma versión menor (lo que P-31b llama «en bloque»).
- `@vercel/ncc` 0.38 → 0.45 (0.x: tratar como mayor), en el mismo PR porque solo afecta a `build:sidecar`. Si el sidecar falla, se separa.
- Rust: `rust-toolchain.toml` en `packages/desktop/src-tauri/` con una versión **exacta** (la stable del día del PR; sin verificar cuál) y el mismo valor en `dtolnay/rust-toolchain` de `release.yml:38`. `rust-version = "1.77"` (`Cargo.toml:7`) se sube a lo que pidan las crates (una fuente no oficial da 1.77.2 como MSRV del núcleo de Tauri 2; sin verificar).

Cambios incompatibles que afectan: `tauri@2.10.0` cambió `with_webview`; `lib.rs` no lo usa (`src/lib.rs:45-59` solo registra plugins). El resto de notas 2.11–2.12 vistas son de Android/Kotlin. La pubkey del updater (`tauri.conf.json:34-39`) no cambia aquí: la rotación es P-09.

Tests y prueba manual: CI no compila Rust en PR (solo `release.yml`, por tag). Para probar se compila en local: Rust 1.96 ya está instalado en el portátil, con las herramientas de C++ y WebView2 (solo falta en el PATH del usuario), así que no hace falta instalar rustup ni un job de Tauri en CI para esta prueba; el job sigue siendo lo que pide la checklist pre-release de ADR 0029. Prueba: `npm run build:sidecar -w @proyecto-shiro/desktop`, `npm run tauri:build`, abrir el binario, ver el tray, cerrar a tray y comprobar que el sidecar arranca y muere con la app.

Reversión: revert; `Cargo.lock` y `package-lock.json` vuelven solos.

#### V5 — Versiones fijadas de servicios, imágenes y Actions por SHA

##### V5a — Letta por digest (= P-06a); base CUDA en P-06b

Va dentro del PR de P-06a (`chore: compose en loopback y Letta fijada`), que solo toca `docker-compose.yml`.

- `docker-compose.yml:26`: `letta/letta:latest` → `letta/letta:<tag>@sha256:<digest>`. **No se hace `pull`**: el agente obtiene el digest de la imagen que ya tiene y funciona (`docker image inspect letta/letta:latest --format '{{index .RepoDigests 0}}'`) y se anota con la fecha. Última release en GitHub: v0.16.8 (la página no muestra el año); la v0.16.7 dejó de imponer límites de bloque y la v0.16.6 cambió defaults (contexto 32k → 128k, bloque 20k → 100k caracteres). Por eso no se sube de versión en este lote: fijar lo que funciona y subir después en un PR propio con backup previo (P-11a).
- La base CUDA (`services/whisper/Dockerfile:9`, misma etiqueta + `@sha256:`) **va en P-06b**, que reescribe ese Dockerfile; el agente saca el digest en el paso 4 de P-06b. No se cambia la versión de CUDA: la GTX 1650 (Turing) con int8 funciona hoy.
- **Estado (2026-11-13).** Base CUDA fijada en el PR #136 con el digest de la imagen con la que se construyó la que ya funcionaba; la imagen reconstruida arranca con GPU.
- Reversión: quitar el digest. Riesgo de datos: ninguno mientras no cambie la versión de Letta (el volumen `letta_pgdata` no se toca).
- **Estado (2026-11-13).** Hecho en el PR #134: `letta/letta@sha256:…`, solo digest y sin etiqueta, porque la imagen local solo tenía `latest`; es Letta 0.16.8.

##### V5b — Whisper: requirements fijados (= P-18)

En el PR de P-18 (`test: suite Whisper completa en CI`):

- `faster-whisper==1.1.1` → `1.2.1` (31-oct-2025, PyPI), con la suite de P-06b/P-18 en verde.
- Fijar `ctranslate2` explícito (`requirements.txt` hoy no lo nombra). Regla oficial: las versiones recientes solo soportan CUDA 12 + cuDNN 9; 4.4.0 es la última para cuDNN 8 y 3.24.0 para CUDA 11. La base `12.6.3-cudnn-runtime` trae cuDNN 9 (sin verificar en la imagen; se comprueba con `pip show` y un arranque en GPU). La última release es v4.9.0 (10-nov). Sobre una GPU Pascal (si Whisper se mueve a otro equipo) **no hay nota oficial**: P-18 ya pide anotar la versión compatible; se fija la que funcione hoy en la GTX 1650 y se prueba la de Pascal cuando toque.
- `requirements-dev.txt` aparte para `pytest`, `pytest-asyncio`, `httpx` (lo pide P-18) y `pip-audit` en CI (no bloqueante al principio).
- Prueba manual: `docker compose build whisper` (descarga de capas: permiso), push-to-talk con una frase, y el log debe decir `cuda` y no caer a CPU.

##### V5c — Actions por SHA y Node 22 fijado (= P-09 y P-28)

- **P-09** (`ci: fija Actions por SHA…`): `actions/checkout@v4` → v7.0.1 por SHA (v7 pasa a ESM y bloquea checkouts de PR de forks en `pull_request_target`/`workflow_run`, que el repo no usa); `actions/setup-node@v4` → v7.1.0 por SHA (v5 pasó a runtime Node 24 y activa la caché sola si hay `packageManager` en `package.json`, que no hay; el repo ya pone `cache: 'npm'`); `dtolnay/rust-toolchain`, `swatinem/rust-cache@v2` y `tauri-apps/tauri-action@v0` por SHA con la versión en comentario. Aplica a `ci.yml:22,25` y `release.yml:29,32,38,41,63`. **Hecho (2026-11-13, PR #140):** los nueve usos van por SHA con la versión exacta en el comentario (checkout v7.0.1, setup-node v7.1.0, setup-python v7.1.0, rust-cache v2.9.3 y tauri-action v0.6.2), que es el commit al que apuntaba la etiqueta que ya se usaba: no sube ninguna versión. `dtolnay/rust-toolchain` va con el SHA de su etiqueta `v1` y `toolchain: stable` explícito: la rama `stable` no lleva etiqueta y, según la documentación de Dependabot, un commit sin etiqueta se actualiza al último commit del repositorio. Un test (`scripts/actions-pinned.test.mjs`) falla si vuelve a entrar una Action sin fijar. Queda por observar con el primer PR de Dependabot que el `ignore` de la versión mayor de tauri-action sigue valiendo con el SHA fijado.
- **P-28** (`chore: Node 22 y comprobación de ABI`): `engines.node` `>=20` → `>=22.13 <23` (`package.json:7-9`; vitest 5 exige 22.12 y ESLint 10 exige 22.13; el portátil tiene 22.20), `.node-version` con `22`, y `node-version-file` en los dos workflows. Node 22 está en mantenimiento hasta el **30-abr-2027** (calendario oficial de Node); Node 20 terminó el 30-abr-2026. El salto a Node 24 se planifica para el primer trimestre de 2027 junto con `pkg --targets node24-win-x64` en `build-sidecar.mjs:123` y la recompilación de better-sqlite3 (o su paso a N-API, ver §4.4).

### 4.4 Lo que NO se actualiza y por qué

| Componente                                                                        | Por qué no                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pixi.js 7.4.3, `pixi-live2d-display-lipsyncpatch` 0.5.0-ls-8, `@pixi/unsafe-eval` | ADR 0021 y CLAUDE.md: Cubism Core 4.2.2 y pixi 7; con el SDK 5/Core 6 el renderer crashea. Solo se **fijan exactos** (sin `^`) como dice P-31b. La integración del avatar está aplazada (ADR 0028).                                                                                                                                                      |
| React 18 → 19 y sus `@types`                                                      | Sin beneficio para el uso actual y arrastra cambios en testing-library y plugins. Se reevalúa con el avatar de ADR 0028.                                                                                                                                                                                                                                 |
| TypeScript 7                                                                      | Compilador nuevo en Go; typescript-eslint necesita alias de npm para funcionar con él (blog de TS 7). Primero 6.0 (V2b).                                                                                                                                                                                                                                 |
| `@types/node` 26                                                                  | El runtime es Node 22; los tipos deben coincidir.                                                                                                                                                                                                                                                                                                        |
| better-sqlite3 13                                                                 | El plan lo descarta (§12). Dato nuevo: 13.0.0 (21-jul-2026) es la primera versión sobre **N-API** con binarios incluidos, lo que en teoría elimina el problema del ABI del sidecar (R-223/R-227). Queda como **opción** para el salto a Node 24, no para este plan. Ojo: 13.1.0 se publicó rota en Windows ARM64 y se sustituyó por 13.1.1 el mismo día. |
| Versión de CUDA de la imagen base                                                 | Funciona con la GPU actual; subirla puede romper drivers. Solo se fija por digest.                                                                                                                                                                                                                                                                       |
| Letta a una versión nueva                                                         | Primero fijar lo que funciona; subir exige backup y prueba de restauración (P-11a).                                                                                                                                                                                                                                                                      |
| `say` 0.16 (SystemTTS)                                                            | Sin avisos y sin release mayor en `npm outdated`.                                                                                                                                                                                                                                                                                                        |

### 4.5 ADR que hay que enmendar

| ADR                                              | Por qué                                                                                                                                                                                                          | Lote                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **0014** (salida estructurada `{text, emotion}`) | Anthropic deja de usar tool `respond` forzada: pasa a `output_config.format` (y, con la opción B, también en el loop). La sección «Anthropic: tool use forzado» (`:51-66`) queda superada                        | V3b                                                                                  |
| **0022** (agentic tools)                         | §5 describe el loop con `tool_choice: any` y la tool terminal `respond`; cambia a `auto` + `strict` + formato estructurado, y se añade la regla «no ejecutar tools si `stop_reason` es `max_tokens` o `refusal`» | Una sola enmienda en V3b (recoge la regla de P-32); si P-31c se recorta, va con P-32 |
| **0016** o una nota en 0012                      | Modelo cloud por defecto y el nuevo parámetro `effort` por ruta (voz `low`, self-dev `medium`), con su efecto en latencia                                                                                        | V3b                                                                                  |
| **0015** (router)                                | Solo si Pipe decide usar Haiku 5.5 como clasificador o como tercer nivel                                                                                                                                         | fuera de lote                                                                        |
| **0018** (Letta)                                 | Imagen fijada por digest y política de subida con backup previo                                                                                                                                                  | V5a                                                                                  |
| **0019** (Whisper)                               | `ctranslate2` fijado y versión de faster-whisper; P-06b ya enmienda topes y bind                                                                                                                                 | V5b                                                                                  |
| **0021** (avatar)                                | Nota de que pixi y lipsyncpatch quedan fijados exactos a propósito (sin cambio de decisión)                                                                                                                      | P-31b                                                                                |
| **0024** (Tauri)                                 | Toolchain de Rust fijada y versión de Tauri; el párrafo de rotación de clave ya lo pone P-09                                                                                                                     | V4                                                                                   |
| **0029** (proceso de una persona)                | La política de §4.6 (dependabot agrupado, cadencia) encaja aquí; si 0029 ya está escrito, como enmienda                                                                                                          | P-04 PR2                                                                             |

§12 («Saltos mayores» descartados), la fila P-31b y la nota de P-28 de `docs/plan-mejora-2026-11.md` ya están corregidos, porque Pipe aprobó V2b-V2d el 2026-11-13.

### 4.6 Política para adelante

- **dependabot:** el archivo es **uno solo, el de P-04 PR2** (§3.7): `npm`, `github-actions`, `cargo` y `pip`, semanal, `open-pull-requests-limit: 2` en npm y 1 en el resto, grupos `npm-produccion` y `npm-desarrollo` (menores y parches) y todas las mayores ignoradas. Este plan no crea otro: lo amplía en ese archivo cuando exista cada lote.
- **Ampliaciones previstas de ese archivo:** grupo `vitest-vite` (vite, vitest, `@vitest/*`, `@vitejs/*`) con V2c; grupo `tauri` multi-ecosistema (`@tauri-apps/*` + crates `tauri*`, para que JS y Rust suban juntos; **sin verificar** que `multi-ecosystem-group` funcione así) con V4; `docker` para `services/whisper` con P-18. Las **mayores no se agrupan**: un PR por mayor.
- **Si Pipe levanta el `ignore` general de majors**, se sustituye por esta lista con comentario: `pixi.js`, `pixi-live2d-display-lipsyncpatch`, `@pixi/*` (ADR 0021), `react`, `react-dom`, `@types/react*` (mayores), `@types/node` (mayores), `typescript` (mayores hasta decidir TS 7) y `@anthropic-ai/sdk` mayores (van a mano, con prueba manual).
- **Seguridad:** los PR de seguridad de dependabot no se agrupan y se revisan en la semana; el audit de producción de P-04 bloquea con high o superior.
- **Cadencia:** una sesión al mes (≈ 1 h) para mergear los grupos menores en verde; mayores como mucho uno por mes y nunca dos el mismo día; revisión trimestral de modelo de Claude (catálogo de modelos y avisos de retirada) y de Node/Rust.
- **Regla de modelos:** el ID del modelo vive solo en `config/modules.config.yaml` y en el default de zod; cualquier cambio de modelo es un PR propio con prueba de voz y nota de coste.

### 4.7 Fuentes (consultadas el 12-nov-2026)

- Guía de migración de modelos de Claude (secciones Sonnet 5, Sonnet 5.5 y Haiku 5.5), catálogo de modelos y guía de la versión de API 2026-10-21, incluidas con la herramienta de Claude Code.
- Migración a la API 2026-10-21, sección TypeScript: https://platform.claude.com/docs/en/api/migration-2026-10-21
- Vitest, migración 4 → 5: https://vitest.dev/guide/migration · 3 → 4: https://v4.vitest.dev/guide/migration
- Vite, migración a 8: https://vite.dev/guide/migration
- TypeScript 6.0: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ · TypeScript 7.0: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- ESLint 10: https://eslint.org/docs/latest/use/migrate-to-10.0.0
- Calendario de Node.js: https://github.com/nodejs/release
- faster-whisper: https://pypi.org/project/faster-whisper/ · CTranslate2: https://github.com/OpenNMT/CTranslate2/releases
- Letta: https://github.com/letta-ai/letta/releases
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3/releases
- Tauri: https://v2.tauri.app/release/
- actions/checkout: https://github.com/actions/checkout/releases · actions/setup-node: https://github.com/actions/setup-node/releases
