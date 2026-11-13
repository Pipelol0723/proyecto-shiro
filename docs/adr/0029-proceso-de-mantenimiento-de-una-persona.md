# ADR 0029: Proceso de mantenimiento de una persona — fuente única, ramas, checks y PRs de agentes

- **Status**: Accepted
- **Fecha**: 2026-11-12
- **Decidido por**: Pipelol

## Contexto

Shiro lo mantiene una persona, 4-6 h/semana, con agentes de IA (y el self-dev
de la propia Shiro) como apoyo. Los documentos y el proceso siguen escritos
para un equipo de 2 y ya no describen la realidad. La revisión del estado de
2026-11 ([`docs/revision-estado-2026-11.md`](../revision-estado-2026-11.md))
lo muestra:

1. El estado de los hitos está copiado en 5 sitios (README, CLAUDE.md,
   AGENTS.md, `docs/architecture.md` y el plan histórico) que ya divergen:
   AGENTS.md no tiene el hito 12 y da el ADR 0025 como `Proposed` (R-240,
   R-242).
2. Se declaran un equipo de 2 y una RTX 5080 que no existen (R-273, R-291,
   R-308).
3. `main` se describe como «estable», pero sigue en el PR #1 y va unos 260
   commits por detrás de `develop`, sin proceso de promoción escrito (R-217).
4. `develop` no exige ningún check de CI, y los PRs de agentes y de self-dev
   solo los filtra el dueño (R-220).
5. Packaging figura completo, pero el único release (v0.1.0) sigue en
   borrador y el auto-updater nunca ha servido una actualización (R-290,
   R-313).
6. La revisión de seguridad de 2026-07 se quedó en foto fija: cuatro meses
   después ningún SEC está cerrado, y ADR 0025 y 0027 están aceptados sin una
   línea de código.
7. La regla de ADR de CLAUDE.md («commit junto al código o separado en el
   mismo PR») no impidió aceptar ADR que nadie implementó.

Lo que no sabemos: si mantener AGENTS.md a mano aguantará hasta que exista un
script que lo compruebe, y cuánto tiempo real de revisión piden los PRs de
agentes.

## Decisión

**Vamos a mantener el proyecto con una sola fuente de verdad por tipo de
información, una sola rama de integración y reglas de PR que hagan seguro
delegar en agentes.**

1. **Roadmap**: el estado de los hitos y la hoja de ruta viven **solo** en la
   tabla Roadmap del README ([`README.md#roadmap`](../../README.md#roadmap)):
   hitos hechos, y Ahora / Siguiente / Ideas. Los demás documentos
   (CLAUDE.md, AGENTS.md, `docs/architecture.md`,
   `docs/estacion-holografica.md`) enlazan a esa tabla y no la copian.
2. **Instrucciones para agentes**: CLAUDE.md es la única fuente. AGENTS.md
   pasa a ser un extracto corto y estable (reglas duras y comandos) que remite
   a CLAUDE.md, para las herramientas que no siguen enlaces. Hoy se mantiene a
   mano; un script lo comprobará más adelante (ítem P-19b del plan de mejora).
   Si difieren, manda CLAUDE.md.
3. **Seguridad**: el estado vive en una tabla viva SEC-xx dentro de
   [`docs/security-review-2026-07.md`](../security-review-2026-07.md), con un
   estado por hallazgo. Todo PR que toque una frontera de confianza actualiza
   su fila en el mismo PR.
4. **Ramas y versiones**: `develop` es la única rama de integración. Las
   versiones son tags `vX.Y.Z` sobre `develop`. `main` deja de describirse
   como «estable»: solo avanza al publicar un tag. PRs pequeños a `develop`;
   las ramas se borran al fusionar. Nadie pushea directo a `main` ni a
   `develop`.
5. **Seguimiento**: no se adopta issue tracker. El seguimiento son las
   casillas del plan de mejora, la tabla Roadmap del README y la tabla SEC-xx.
6. **PRs de agentes o de self-dev**: citan el lote L-xxx y los R-xxx que
   cierran, con un diff de 300 líneas como máximo (salvo excepción justificada
   en el PR), test rojo→verde (o verificación manual descrita) y checks en
   verde. Como mucho 2 PRs de agente abiertos a la vez.
7. **Regla única de ADR**: un ADR nuevo va en un PR `docs:` propio, fusionado
   antes que su código. La enmienda de un ADR existente viaja en el mismo PR
   que el código que la cumple. Los ADR no se reescriben: solo se corrige el
   Status, se arreglan enlaces o se añade al final una nota fechada.
8. **Checklist pre-release**, obligatoria antes del primer tag nuevo: build
   del sidecar y de Tauri en CI; tag igual a la versión; tests en verde antes
   de firmar; clave del updater rotada y custodiada; LICENSE presente.
9. Lo que este ADR decide y aún no está hecho se lista en sus Notas de
   implementación con el ítem del plan que lo hará, sin darlo por hecho.

## Alternativas consideradas

- **Sincronizar a mano los 5 documentos con una checklist de cierre de
  hito**: es lo que se hacía y ya falló: AGENTS.md perdió el hito 12 y tres
  documentos siguen citando un ADR superseded. A 4-6 h/semana, cada copia
  extra es una deuda que nadie paga.
- **Un `docs/roadmap.md` como fuente del roadmap**: añade un archivo más que
  enlazar y que se olvida. El README es lo primero que se lee y ya tenía la
  tabla; basta con declararla única.
- **GitHub Issues / Projects como seguimiento**: superficie nueva que una
  persona no va a mantener; el plan ya tiene casillas por ítem y la revisión
  tiene IDs estables (R-xxx, L-xxx, SEC-xx). Se reconsidera si vuelve a haber
  más de una persona.
- **git-flow con promoción periódica develop → main**: pide horas de
  promoción que no hay; `main` lleva desde mayo sin moverse precisamente por
  eso. Con tags sobre `develop` la versión publicada queda identificada sin
  una segunda rama viva.
- **Archivar o borrar `main`**: opción válida y más barata, pero romper la
  rama histórica y los enlaces externos no aporta nada: basta con que solo se
  mueva al publicar un tag y deje de prometer estabilidad.
- **AGENTS.md canónico y CLAUDE.md reducido a un import**: CLAUDE.md es lo
  que leen Claude Code y la mayoría de agentes del proyecto, y la denylist de
  self-dev ya lo protege como inmutable mientras que AGENTS.md no; poner la
  fuente en AGENTS.md la dejaría escribible por self-dev.
- **AGENTS.md como simple puntero a CLAUDE.md**: Codex y otras herramientas
  no siguen enlaces: un puntero las deja sin reglas duras. Un extracto corto y
  estable cambia poco y se puede comprobar con un script.
- **Generar AGENTS.md por script ya**: es la meta (P-19b), pero hoy no existe
  el script ni el comando `verify` donde engancharlo; mientras tanto, un
  extracto pequeño y estable se mantiene a mano sin coste apreciable.
- **Exigir aprobaciones de revisión en `develop`**: con una persona no hay
  quien apruebe; el filtro útil es un check de CI obligatorio más las reglas
  de PR de agentes.
- **Mantener la regla vieja de ADR («commit junto al código o en el mismo
  PR»)**: permitió aceptar ADR 0025 y 0027 sin código y mezclar decisión e
  implementación en PRs grandes. Separar el ADR nuevo (antes) de la enmienda
  (con el código) deja la decisión revisable sola y la enmienda atada a lo
  que la cumple.
- **Publicar ya v0.1.0 (o un v0.1.1) para probar el updater**: la clave de
  firma no tiene passphrase, `release.yml` no corre tests y el CI nunca
  construye el sidecar ni Tauri: publicar ahora distribuiría un binario sin
  las garantías mínimas. La checklist pre-release fija cuándo sí.
- **PRs de agentes sin límite de tamaño ni de número**: la revisión humana es
  el cuello de botella; diffs grandes o muchos PRs abiertos convierten la
  revisión en un sello. 300 líneas y 2 PRs abiertos mantienen la revisión
  centrada en la intención.

## Consecuencias

### Positivas

- Un solo sitio que actualizar al cerrar un hito o cambiar de plan; los demás
  documentos dejan de divergir.
- Los agentes (Claude y otros) leen las mismas reglas, y las reglas duras
  llegan también a las herramientas que no siguen enlaces.
- El estado de seguridad deja de ser una foto: cada PR de seguridad mueve su
  fila.
- La política de ramas describe lo que hay: `develop` + tags, sin una `main`
  «estable» ficticia.
- Delegar en agentes y en self-dev se vuelve revisable: lote citado, diff
  acotado y test rojo→verde.
- No se corta ningún tag sin las garantías mínimas de la checklist.

### Negativas / Riesgos

- Mientras no exista el script de P-19b, AGENTS.md puede volver a divergir de
  CLAUDE.md si se olvida actualizarlo.
- Hasta que el dueño marque el check como obligatorio en GitHub (P-04),
  «checks en verde» sigue siendo disciplina, no una barrera.
- Dos PRs por cada ADR nuevo (el ADR y luego su código) añaden algo de
  ceremonia.
- La checklist pre-release es manual hasta que llegue al CI; aplaza cualquier
  release hasta cumplirla.
- El límite de 300 líneas obliga a partir algunos cambios en varios PRs.

### Neutrales

- La rama `main` sigue existiendo; solo cambia lo que promete.

## Notas de implementación

- **Hecho en el PR de este ADR** (P-03a del plan, solo documentación): tabla
  única en el README con ancla `#roadmap`; CLAUDE.md sin copia de los hitos y
  con la política de ramas, las reglas de PR de agentes y la regla única de
  ADR; AGENTS.md reducido a extracto; tabla viva SEC-xx en
  `docs/security-review-2026-07.md`; CONTRIBUTING.md con ramas y checklist
  pre-release; fila 0029 y estados reales en `docs/adr/README.md`; notas
  fechadas en los ADR 0019-0028.
- **Pendiente — check de CI obligatorio en `develop`**: lo marca el dueño en
  GitHub cuando el CI tenga audit y permisos mínimos (P-04).
- **Pendiente — `npm run verify`** (compila core y ejecuta `format:check`,
  `lint`, `typecheck`, `test` y `build`): P-02. Hasta entonces, «checks en
  verde» = esos pasos en ese orden, empezando por
  `npm run build -w @proyecto-shiro/core`.
- **Pendiente — script que comprueba AGENTS.md frente a CLAUDE.md** (y
  enlaces, rutas citadas y ADR Accepted que digan «Proposed») dentro de
  `verify`: P-19b.
- **Pendiente — checklist pre-release**: hoy se comprueba a mano antes del
  primer tag. Llevarla al CI (build del sidecar y de Tauri, tag igual a la
  versión y tests antes de firmar en `release.yml`) son los lotes L-TOOL-11 y
  L-TOOL-10, aparcados en el plan de mejora; la clave rotada con passphrase y
  custodiada es P-09 y el LICENSE es P-20 (ADR 0030 propuesto).
- **Pendiente — borrar las ramas ya fusionadas o muertas y la plantilla de
  encargo para agentes y self-dev**: P-03b (cada borrado lo confirma el
  dueño).

## Referencias

- [`docs/plan-mejora-2026-11.md`](../plan-mejora-2026-11.md) — §2 (decisiones
  de contexto), §6 (ADR propuestos) y §9 (cómo se trabaja con agentes).
- [`docs/revision-estado-2026-11.md`](../revision-estado-2026-11.md) y
  [`docs/revision-estado-2026-11-anexo.md`](../revision-estado-2026-11-anexo.md)
  — hallazgos R-217, R-220, R-240, R-242, R-273, R-290, R-291, R-308 y R-313.
- [`README.md`, sección Roadmap](../../README.md#roadmap) — la tabla única.
- [`docs/security-review-2026-07.md`](../security-review-2026-07.md) — tabla
  viva SEC-xx.
- [ADR 0023](0023-shiro-self-improvement-propose-only.md) (self-dev
  propose-only) y [ADR 0024](0024-packaging-tauri-windows-sidecar.md)
  (packaging, auto-updater y release por tag).
- [ADR 0025](0025-modelo-de-confianza-local-y-superficie-de-red.md) y
  [ADR 0027](0027-autenticacion-token-bus-stt-multicliente.md) — ejemplos de
  ADR aceptados sin implementar que motivan la regla única.

## Nota 2026-11-13

El dueño aprobó la Fase 1 del plan de mejora y fijó tres reglas de proceso:

- **Fusión delegada durante la Fase 1.** Los PRs de la Fase 1 los fusiona el
  agente, sin revisión previa del dueño, siempre que se cumplan dos
  condiciones: el CI está en verde y un segundo agente ha revisado el diff.
  La delegación es expresa y solo vale para la Fase 1; en las demás fases el
  dueño aprueba cada fase antes de empezarla. El dueño la dio de palabra y
  la puede retirar cuando quiera: el agente le informa de cada fusión, y una
  sesión nueva la confirma con él antes de fusionar. No se ha llevado a
  CLAUDE.md ni a AGENTS.md: las instrucciones para agentes siguen diciendo
  solo que todo entra por PR.
- **Tareas manuales.** Las tareas manuales que el plan asignaba al dueño en
  la Fase 1 (borrar ramas remotas muertas, ajustes de GitHub como las alertas
  de Dependabot y el check obligatorio, arrancar Docker y sacar digests,
  pruebas manuales de red, del modal y del log) las hace el agente. Al dueño
  solo se le pide lo que solo él puede hacer: pagar o cambiar de plan,
  iniciar sesión, crear y pegar claves, escuchar la voz y elegir, y grabar su
  voz.
- **`main` por fast-forward.** Al publicar un tag, `main` avanza por
  fast-forward hasta ese tag.

Ese mismo día se creó `npm run verify` (P-02), así que el pendiente de
«Consecuencias» queda cumplido: «checks en verde» significa `npm run verify`
en verde.
