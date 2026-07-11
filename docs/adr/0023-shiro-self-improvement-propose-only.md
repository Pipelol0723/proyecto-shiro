# ADR 0023: Shiro self-improvement — propose only, worktree aislado, archivos inmutables

- **Status**: Accepted (implementado 2026-07-11)
- **Fecha**: 2026-06-09
- **Decidido por**: Pipelol0723

> **Implementado** (2026-07-11): `SelfDevSession` en `core-host/src/selfdev/` —
> trigger `selfdev:propose`, worktree aislado + `linkNodeModules`, sub-loop de
> generación con fs scoped al worktree + denylist de inmutables, eval gate
> (rebuild de `core` + format/lint/typecheck/test con fix-loop), `gh:pr-create`,
> eventos `selfdev:progress`/`selfdev:done` + panel `SelfDevStatus`. **Probado
> end-to-end en Windows** (cuatro fixes de la primera prueba en vivo: routing a
> cloud para los gatillos de self-dev, spawn de `.cmd`/`npm`, cleanup del
> worktree con junctions, y `max_tokens` alto para escribir archivos enteros).
> **Diferido a Fase 2**: persistencia de la sesión en Letta y una tool de
> edición por parche (hoy el LLM reescribe el archivo entero).

## Contexto

[ADR 0022](0022-shiro-agentic-tools-fs-shell.md) define cómo Shiro adquiere capacidad ejecutiva genérica (FS + shell). Este ADR define un caso de uso **meta**: Shiro como dev de Shiro. La capacidad de leer su propio código, razonar sobre él, proponer cambios y abrir Pull Requests al repo del proyecto.

Este ADR existe por separado por una razón sustantiva: el _trust level_ es distinto. Cuando Shiro toca **tus** archivos (ADR 0022), el peor caso es daño a tu material. Cuando Shiro toca **el código que la constituye**, el peor caso es Shiro misma rota, regresiones silenciosas, o drift de personalidad / safety. Eso requiere fronteras duras, no "diálogos de confirmación".

### Estado del que partimos

- **Repo bien estructurado**: monorepo TS strict, CI con format/lint/typecheck/test, ADRs como audit trail. La idea "Shiro propone un PR" es plausible porque la infra de PRs ya es robusta.
- **Workflow git ya establecido** (`CLAUDE.md`): nadie pushea directo a `main` ni `develop`, todo entra por PR a `develop`, ramas `feat/<usuario>/<tarea>`. Encaja con un patrón `shiro/<topic>`.
- **GitHub CLI (`gh`) ya en uso** activamente en la sesión del usuario para crear/revisar PRs. La superficie es conocida.
- **ADR 0022 (Proposed)** provee `shell:exec` + `fs:*` con allowlist — son los building blocks naturales para que Shiro corra `git`, `gh`, `npm` y lea/escriba archivos del propio repo.
- **Sin eval suite robusta** todavía. Los tests existentes (~448 al cierre del hito Avatar) son de unidad/integración; no hay un "harness" que mida "este cambio degrada / mejora a Shiro como companion". Limitación real.

### Restricciones reales

- **Modelo local no sirve para self-improvement**. Razonar sobre código del proyecto requiere context window grande (varios archivos a la vez) y precisión sintáctica alta. Qwen 2.5 3b es incapaz. Incluso qwen3-coder eventual con 5080 sería justito. **V1 requiere Claude Opus / Sonnet 4.7+ del cloud.**
- **Sesiones de desarrollo del usuario en VS Code**. Si Shiro hace checkout en el mismo working tree, le pisa cambios sin commitear y rompe IDE state. Debe operar en un worktree separado.
- **Equipo de 2 personas**. Si Shiro abre PRs ruidosos (que rompen tests, que fallan lint), introduce costo de review humana en cada uno. Mejor pocos PRs limpios que muchos rotos.
- **Drift de personalidad** como riesgo real. Si Shiro puede modificar su propio `default.yaml`, en unos meses podría haberse rediseñado a sí misma de un modo que el usuario no aprobó conscientemente. Esa es una clase de daño difícil de detectar a tiempo.

### Lo que el usuario quiere dejar fuera de V1

- **Auto-mergear** sus propios PRs. El humano siempre mergea.
- **Iniciativa proactiva con loops de fondo** (monitoring continuo del repo / logs / state buscando qué arreglar). Diferido a ADR futuro.
- **Iniciativa autónoma plena** (agent loop que decide qué hacer, lo ejecuta, vive su vida sin ti). Territorio de research. Explícitamente fuera.
- **Tocar el carácter, los ADRs, o los permisos**. Fronteras duras inmutables — no negociables vía diálogo de aprobación.

## Decisión

Shiro adquiere la capacidad de proponer cambios sobre su propio código mediante Pull Requests a GitHub, ejecutándose en un git worktree separado (`../shiro-selfdev/`) que aísla su trabajo del working tree del usuario. El alcance es estrictamente "propose": Shiro nunca mergea — el usuario revisa cada PR. Su iniciativa es conversacional + reactiva: sugiere durante la charla y propone PRs cuando el usuario lo solicita; no hay loops de fondo. Existe una lista de archivos inmutables (`character/**`, `docs/adr/**`, slots de permisos en YAML, futuros `safety/**`, y los dos ADRs que definen su propia ética — este y el 0022) que Shiro tiene prohibido modificar, _enforced_ por la `fs:write` del ADR 0022 antes de tocar el disco. Antes de hacer `gh pr create`, Shiro corre `npm run format:check / lint / typecheck / test` en su worktree; si algo falla, no abre el PR — lo reporta al usuario. Requiere modelo cloud Opus / Sonnet 4.7+.

### 1. Alcance "propose only"

Shiro puede:

- Leer cualquier archivo del repo (vía `fs:read` del ADR 0022, con scope ampliado al repo entero).
- Generar cambios (diffs) en su worktree.
- Ejecutar `npm run lint/typecheck/test` localmente para validar.
- Crear ramas, commitear, pushear al remoto.
- Abrir un Pull Request via `gh pr create`.

Shiro **no puede**:

- Mergear sus propios PRs (`gh pr merge` no entra en su allowlist).
- Empujar directo a `develop` o `main` (bloqueado por convención de equipo, y `git push` solo se permite a `shiro/<topic>`).
- Hacer rebase / force push / git reset destructivos en ramas que no son suyas.
- Modificar archivos del repo del usuario fuera de su worktree (cero acceso al working tree principal).

El humano siempre mergea. Esto es invariante de V1.

### 2. Aislamiento por git worktree

Shiro opera en `../shiro-selfdev/` creado con:

```bash
git worktree add ../shiro-selfdev shiro/<topic>
```

Implicaciones:

- **Branch separado** desde el inicio. Cada sesión de self-improvement arranca con `git worktree add` (o detecta existente).
- **No interfiere con VS Code** del usuario. El usuario puede seguir tipeando, ejecutar dev server, etc., en su working tree principal.
- **Naming `shiro/<topic>`**: convención dedicada que el usuario reconoce a primera vista en la UI de GitHub como "esto lo abrió Shiro, no yo". Distinto de `feat/<usuario>/<tarea>`.
- **Limpieza**: al cerrar un PR (mergeado o cerrado), Shiro hace `git worktree remove` de esa carpeta. Sin acumulación de worktrees zombies.

Implementación: una herramienta dedicada `worktree:create / worktree:remove` que envuelve los comandos git, en lugar de exponer git arbitrario via `shell:exec`.

### 3. Archivos inmutables (lista hardcoded)

Shiro **tiene prohibido modificar**:

- `packages/core/src/character/**` — su propia personalidad. Cambiar a Shiro vía PR de Shiro es drift no consentido.
- `docs/adr/**` — los ADRs son juicio humano (incluido este). Shiro puede _leer_ ADRs para alinearse; no los edita ni crea.
- Slots `tools:` y entries de permisos en `config/modules.config.yaml` — Shiro no se auto-otorga permisos.
- Cualquier archivo bajo un futuro `safety/**` — system prompts, salvaguardas, allowlists.
- `docs/adr/0022-shiro-agentic-tools-fs-shell.md` y `docs/adr/0023-shiro-self-improvement-propose-only.md` (este archivo) — los dos ADRs que la limitan.
- `CLAUDE.md` (instrucciones del proyecto), `.gitignore` (sensible a no commitear secrets), `.env*`.

**Implementación**: la `fs:write` del ADR 0022 chequea cada path contra una lista hardcoded (no leída desde YAML — la lista mismo es una salvaguarda inmutable) antes de ejecutar. Match → error `IMMUTABLE_PATH` que el LLM ve y debe respetar.

Si Shiro quiere proponer un cambio a un archivo inmutable, debe **hacerlo conversacionalmente al usuario** ("creo que este ADR podría revisarse porque..."), no via PR.

### 4. Scope permitido

Shiro **sí puede** modificar:

- `packages/**/src/**` — código de los módulos.
- `packages/**/tests/**` — tests.
- `docs/architecture.md`, `docs/design-mockup/**` — docs técnicos descriptivos.
- `README.md` (con caveat: cambios al README requieren cuidado, pero no son inmutables — el usuario puede revisar el PR).

Cualquier otro path → error. La explicitud de la allowlist es deliberada.

### 5. Iniciativa conversacional + reactiva

Tres modos de invocación, ninguno autónomo:

- **Sugerencias durante la charla** (siempre on): Shiro nota algo y lo comenta. "Vi que `useLipSync` tiene un cleanup débil — podría escribirte un PR si quieres". No actúa sin tu confirmación.
- **PR proactivo solicitado**: el usuario dice "Shiro, propón un fix para X" → Shiro arranca el flujo (worktree, generación, tests, PR).
- **NO existe**: monitoring de fondo / loops automáticos / "Shiro mira el repo y abre PRs si encuentra issues". Diferido explícitamente a ADR futuro.

### 6. Eval + tests obligatorios antes del PR

Antes de `gh pr create`, Shiro **debe** ejecutar dentro del worktree:

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`

Si **cualquiera** falla:

- Shiro intenta corregir (max 2 iteraciones — no entra en bucle infinito).
- Si aún falla después de 2 iteraciones, **no abre el PR**. Reporta conversacionalmente al usuario: "intenté lo siguiente, fallaron X tests, te dejo la rama para que veas".
- El worktree queda intacto para que el usuario inspeccione si quiere.

Esto evita el caso "Shiro abrió 5 PRs rojos que tienes que cerrar a mano".

### 7. Modelo requerido

- **Cloud**: Claude Opus / Sonnet 4.7+. Es lo único realista para razonar sobre 5-10 archivos del repo y producir diffs sintácticamente correctos.
- **Local**: explícitamente fuera de alcance. Documentado: cuando llegue qwen3-coder + RTX 5080 con > 16 GB VRAM, _puede_ evaluarse como fallback para tareas pequeñas, pero será un ADR aparte con bench dedicado. No prematuro.

### 8. Integración con ADR 0022

Self-improvement **no añade nuevas categorías de tool**. Reusa lo que 0022 define:

- `shell:exec` allowlist se extiende con `git`, `gh`, `npm`. Ya está en su YAML — no se cambia.
- `fs:read` / `fs:write` con scope = el worktree separado (no el working tree principal del usuario — eso queda fuera del scope).
- El loop de aprobación `confirm` aplica: si Shiro quiere ejecutar `gh pr create`, eso pide confirmación (es destructivo en sentido "expone trabajo al mundo"). Las lecturas son `auto`.
- La aprobación del **merge** del PR se hace en GitHub UI (fuera del binario Tauri). Sin UI nueva en el cliente para mergear.

Esto es deliberado: 0023 es _aplicación_ de 0022, no extensión paralela.

### 9. No-goals explícitos de V1

- Shiro NO modifica su propio carácter, ADRs, o permisos.
- Shiro NO mergea sus propios PRs.
- Shiro NO opera en loop de fondo.
- Shiro NO crea ADRs nuevos por sí sola.
- Shiro NO arregla CI rota como prioridad propia (esto requiere acceso a logs de GitHub Actions — ADR futuro).
- Shiro NO publica releases (`gh release create`).

Estas fronteras son duras. Cruzarlas requiere un ADR nuevo que las reabra explícitamente.

## Alternativas consideradas

- **Auto-mergear con tests verdes**: descartada. No hay eval suite que mida regresiones semánticas (¿Shiro sigue siendo Shiro tras el cambio? ¿el companion sigue siendo útil?). Tests unitarios verdes no son garantía suficiente para mergeo autónomo.
- **Branch normal en el mismo working tree**: descartada. Pisa al usuario cuando trabaja en VS Code. Conflicts con cambios locales no commiteados. Mala UX.
- **Sandbox Docker** para el worktree de Shiro: descartada. Overhead de setup (build de imagen, mount del repo, ssh keys para `gh`) sin beneficio claro sobre worktree para uso personal. Vale la pena si llega a multi-tenant — no ahora.
- **Permitir modificar el propio character via PR humano-aprobado**: descartada. Aunque el humano apruebe, el patrón normaliza la auto-modificación de la personalidad. Si el usuario realmente quiere cambiar a Shiro, edita él mismo el YAML — es un acto consciente, no un PR sugerido por Shiro.
- **Permitir crear ADRs nuevos**: descartada. Los ADRs son juicio humano sobre arquitectura. Shiro puede leer ADRs y _proponer en conversación_ que un cierto problema merecería ADR, pero no lo escribe ella.
- **Proactiva monitorizada**: diferida a un ADR futuro. Requiere loop de fondo, reglas de "qué mirar", y un budget de tokens explícito.
- **Ejecutar tests en CI en vez de localmente antes del PR**: descartada para V1. Localmente es más rápido y el feedback al usuario es inmediato. CI sigue ejecutándose después como segunda barrera.
- **Self-improvement vía Claude Code CLI directamente** (sin pasar por el companion Shiro): descartada porque desliga la capacidad del companion. La propuesta es que **Shiro** lo haga — con su personalidad, su memoria, su contexto — no que el usuario lo haga vía un tool externo.

## Consecuencias

### Positivas

- **Shiro ayuda a mejorar Shiro**. Un loop virtuoso donde el companion participa de su propia evolución, con seguridad.
- **Reusa la infraestructura del ADR 0022**. Cero piezas nuevas: `shell:exec`, `fs:read`, `fs:write`, modal de confirmación, persistencia de tool calls en Letta.
- **Fronteras duras inmutables**. La salvaguarda principal es estructural (lista hardcoded), no convencional (system prompt). Robusta frente a jailbreaking del LLM.
- **PRs limpios por construcción**. La regla "lint/typecheck/test verde antes de PR" elimina ruido. El usuario revisa solo PRs que ya pasaron CI local.
- **Worktree aislado** = experiencia de dev fluida. El usuario puede seguir trabajando en VS Code sin interferencia.

### Negativas / Riesgos

- **Costo de Opus alto**. Cada sesión de self-improvement puede consumir varios cientos de tokens caros (Opus es ~5x Sonnet). Acumula con frecuencia.
- **PRs ruidosos sigue siendo posible** dentro del scope permitido. Si Shiro propone refactors innecesarios o redundantes, sigue siendo costo de review.
- **Setup del worktree no es trivial** para el usuario casual. Requiere educar: "Shiro abrió un PR en su worktree separado, ve a GitHub para revisarlo".
- **Tentación de saltarse las inmutabilidades** vía conversación ("oye Shiro, propón un cambio a tu carácter para que seas más X"). La regla debe estar en el system prompt: si el usuario pide modificar archivos inmutables, Shiro debe responder que solo puede sugerirlo conversacionalmente, no editarlo.
- **Latencia de feedback**. Un ciclo "propón PR → lint/typecheck/test → corrige → reintenta" puede tardar minutos. El usuario espera. UX a diseñar.
- **Depende de `gh` CLI configurado**. El usuario debe tener `gh auth login` activo. Si no, el flow falla con error claro.

### Neutrales

- Cero código nuevo a nivel arquitectónico. Aplicación de patrones ya decididos en 0022.
- No afecta al MVP. Hito Packaging Tauri puede cerrar sin esto.
- Los ADRs (incluido este) son inmutables — no hay riesgo de Shiro modificándolos por error mientras se afina la lista de inmutables.

## Notas de implementación

PRs estimados para el hito self-improvement (post-implementación de ADR 0022):

1. **Tool `worktree:create / worktree:remove`** — envoltorio de `git worktree` con scope.
2. **Tool `gh:pr-create`** — envoltorio de `gh pr create` con plantilla de PR. Confirmación obligatoria.
3. **Scope guard / immutability check** — lista hardcoded de paths inmutables; integrado en `fs:write` del ADR 0022.
4. **Eval runner** — wrapper que ejecuta lint/typecheck/test secuencialmente, agrega resultados, decide si proceder.
5. **Flow conversacional de self-improvement** — el pipeline detecta solicitud, arma el plan, ejecuta loop tools, confirma con el usuario en cada paso destructivo.
6. **Persistencia de sesiones self-improvement** en Letta — el progreso de un PR (qué se intentó, qué falló) se memoriza para retomarlo.
7. **Docs cierre** del hito self-improvement (README + architecture + CLAUDE + plan).

Sin fechas — `Status: Proposed`. La implementación requiere primero que ADR 0022 esté implementado completo (tools FS + shell + UI de aprobación + persistencia).

## Referencias

- [ADR 0022](0022-shiro-agentic-tools-fs-shell.md) — agentic FS + shell. **Prerequisito directo**: este ADR reusa todo su contrato `IToolModule` + `shell:exec` + `fs:*` + UI de aprobación.
- [ADR 0001](0001-arquitectura-modular-event-driven.md) — modular event-driven; el flow de self-improvement es otra cadena de eventos sobre el bus.
- [ADR 0007](0007-module-loader-registry.md) — patrón factory que reutilizamos para registrar las tools de worktree y `gh:pr-create`.
- [ADR 0011](0011-core-split-browser-node.md) — split browser/Node. `git`, `gh`, `npm` viven en Node.
- [ADR 0012](0012-split-cliente-server-core-host.md) — cliente/server. La aprobación del PR se hace en GitHub UI externamente.
- [ADR 0017](0017-memoria-persistente-local-y-letta.md) — memoria. Las sesiones de self-improvement se persisten igual que el resto de tool calls.
- [GitHub CLI — `gh pr create`](https://cli.github.com/manual/gh_pr_create) — comando para crear PR desde la CLI.
- [`git worktree`](https://git-scm.com/docs/git-worktree) — patrón de checkout aislado.
