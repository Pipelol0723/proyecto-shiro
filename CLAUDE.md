# Instrucciones para Claude — Proyecto Shiro

Este archivo lo lee Claude Code automáticamente al iniciar una sesión
en este repo. Léelo entero antes de hacer cualquier cosa estructural.

## Qué es este proyecto

AI Companion modular tipo VTuber con voz, memoria y avatar animado.
Diseñado para escalar de app desktop a sistema con múltiples clientes
(móvil, Arduino, IoT, robots simples). Lo mantiene una persona, 4-6 h/semana,
con agentes de IA como apoyo. Hardware de desarrollo: un portátil con una
GTX 1650 de 4 GB, donde corre todo el stack.

**Lectura obligatoria antes de tomar decisiones arquitectónicas:**

- [`README.md` → Roadmap](README.md#roadmap) — **única fuente** del estado de los hitos y de la hoja de ruta (ADR 0029).
- [`docs/plan-mejora-2026-11.md`](docs/plan-mejora-2026-11.md) — lo que toca ahora (la Fase 1 está aprobada desde el 2026-11-13 y en ejecución; las demás fases, pendientes de aprobación), con la [revisión](docs/revision-estado-2026-11.md) y su [anexo](docs/revision-estado-2026-11-anexo.md). Ningún ítem P-xx se ejecuta sin que el dueño apruebe su fase.
- [`docs/architecture.md`](docs/architecture.md) — vista actual de la arquitectura, con diagramas mermaid.
- [`docs/adr/`](docs/adr/) — historial de decisiones con su porqué. Léelo cuando algo te haga dudar de "por qué se hizo así".
- [`docs/design/shiro-character-bible.md`](docs/design/shiro-character-bible.md) — biblia del personaje (v0.2): identidad visual aprobada, tono y sistema de expresiones. Léela antes de tocar el avatar o producir arte de Shiro. El formato del avatar está en [ADR 0028](docs/adr/0028-avatar-motores-y-manifiesto.md) (Accepted, sin implementar; integración aplazada).
- [`docs/security-review-2026-07.md`](docs/security-review-2026-07.md) — revisión de seguridad con la **tabla viva SEC-xx**, y [ADR 0027](docs/adr/0027-autenticacion-token-bus-stt-multicliente.md) (token, bind y Origin; Accepted y **en curso**: el bus y `/audio` ya escuchan solo en `127.0.0.1` salvo `SHIRO_BIND_HOST` y rechazan un `Origin` ajeno, pero siguen sin token; compose publica Letta y Whisper solo en `127.0.0.1` salvo `LETTA_BIND` y `WHISPER_BIND`, y Whisper tiene topes de audio y allowlist de `Origin`, también sin token). Léelos antes de tocar fronteras de confianza (auth, bind de red, permisos de tools, ACL de Tauri).
- [ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md) — cómo se mantiene el proyecto: ramas, PRs de agentes, regla de ADR y checklist pre-release.
- [`plan-modular-ai-companion.md`](plan-modular-ai-companion.md) — plan y visión original (histórico).

<!-- agents-md:start -->

## ⚠️ Cuándo escribir un ADR (no te lo saltes)

Antes de implementar algo que cumpla **AL MENOS UNA** de estas condiciones,
**pausa y propón al usuario escribir un ADR**:

1. Afecta a más de un módulo o paquete del monorepo.
2. Es difícil o caro de revertir.
3. Introduce o descarta una dependencia importante (librería nueva, servicio externo, formato de datos).
4. Establece un patrón que otros módulos seguirán (naming de eventos, esquema de config, convenciones de errores, etc.).
5. El dueño, en 3 meses, preguntaría "¿por qué hicimos esto así?".

### Cómo crear un ADR

1. Copia `docs/adr/template.md` a `docs/adr/NNNN-titulo-en-kebab-case.md`,
   donde `NNNN` es el siguiente número libre con padding de 4 dígitos.
2. Rellena todas las secciones. La sección **"Alternativas consideradas"**
   es la más importante — ahí se ve el pensamiento.
3. Añade una fila en el índice de [`docs/adr/README.md`](docs/adr/README.md).
4. **Regla única** (ADR 0029): un ADR **nuevo** va en un PR `docs:` propio,
   fusionado **antes** que su código (mensaje sugerido: `docs: add ADR NNNN — <título corto>`).
   La **enmienda** de un ADR existente viaja en el **mismo PR** que el código que la cumple.
   Los ADR son registro histórico: no se reescriben su contexto ni su decisión; solo se
   corrige el Status, se arreglan enlaces o se añade al final una nota fechada.
5. Si supersede un ADR previo, cambia el `Status` del antiguo a `Superseded by NNNN`. No lo borres.

### Cuándo NO hace falta ADR

- Bugfixes locales sin cambio de patrón.
- Refactors cosméticos (renombrar variables, mover archivos).
- Tareas operativas (CI tweaks, bumps de dependencias menores, formato).
- Decisiones reversibles en menos de 30 minutos sin tocar otros módulos.

<!-- agents-md:end -->

## Estructura del monorepo

```
packages/
├── core/        → @proyecto-shiro/core       (cerebro headless, browser-safe + entry Node)
├── core-host/   → @proyecto-shiro/core-host  (server Node, arranca el Orchestrator y expone WebSocket)
└── desktop/     → @proyecto-shiro/desktop    (cliente Vite + React + TS)

services/whisper/  → microservicio STT (Python + faster-whisper)
docker-compose.yml → Letta y Whisper
config/            → modules.config.yaml + devices.config.yaml (runtime)
docs/              → architecture.md + adr/ + design/ + design-mockup/ + revisión y plan de 2026-11
```

Paquetes previstos: `mobile`, `arduino-bridge`, `iot-bridge`, `station` (cliente de la estación holográfica). Todos
consumirán `@proyecto-shiro/core` como dependencia local y se conectarán
al `core-host` por WebSocket (mismo patrón que el cliente desktop).

### Estado y hoja de ruta

El estado de los hitos y la hoja de ruta (Ahora / Siguiente / Ideas) viven
**solo** en la tabla [Roadmap del README](README.md#roadmap)
([ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md)). No los
copies aquí ni en otro documento: enlaza a esa tabla. Para el detalle técnico
de cada hito, lee [`docs/architecture.md`](docs/architecture.md) y su ADR.

<!-- agents-md:start -->

## Convenciones de Git

### Ramas

- `develop` → única rama de integración (rama por defecto).
- Versiones: tags `vX.Y.Z` sobre `develop`. `main` no es una rama «estable»: solo avanza al publicar un tag, por fast-forward hasta ese tag.
- `feat/<nombre>/<tarea>` → trabajo individual; la rama se borra al fusionar.
- `claude/<tarea>` → sesiones de agentes; `shiro/<tema>` → propuestas de self-dev. También se borran al fusionar.

### Reglas

- **Nadie pushea directo a `main` ni `develop`**. Todo entra por PR.
- PR base = `develop`, no `main`.
- PRs pequeños a `develop` y commits pequeños y frecuentes (~30-60 min de trabajo).
- Sin issue tracker: el seguimiento son las casillas del [plan de mejora](docs/plan-mejora-2026-11.md), la tabla [Roadmap del README](README.md#roadmap) y la tabla SEC-xx de la [revisión de seguridad](docs/security-review-2026-07.md).

### PRs de agentes y de self-dev (ADR 0029)

- Citan el lote `L-xxx` y los hallazgos `R-xxx` que cierran (ver el [plan de mejora](docs/plan-mejora-2026-11.md) y la [revisión](docs/revision-estado-2026-11.md)).
- Diff de 300 líneas como máximo, salvo excepción justificada en el PR.
- Test rojo→verde, o verificación manual descrita.
- Checks en verde (ver «Antes de pushear»).
- Como mucho 2 PRs de agente abiertos a la vez.
- Un PR que toque una frontera de confianza actualiza su fila en la tabla SEC-xx.
- El encargo se escribe con la [plantilla de CONTRIBUTING](CONTRIBUTING.md#encargar-trabajo-a-un-agente).

### Prefijos de commit (siempre minúscula + `:`)

| Prefijo  | Uso                                   |
| -------- | ------------------------------------- |
| `feat:`  | nueva funcionalidad                   |
| `fix:`   | corrección de bug                     |
| `test:`  | añadir o mejorar tests                |
| `docs:`  | documentación                         |
| `refac:` | refactor sin cambio de comportamiento |
| `chore:` | mantenimiento (deps, configs)         |
| `ci:`    | cambios al workflow de CI             |

## Antes de pushear

Ejecuta `npm run verify`. Si falla, no pushes: arregla primero.

```bash
npm run verify
```

Hace los mismos pasos que el CI, en el mismo orden, y se detiene en el primero
que falla: compila core (`npm run build -w @proyecto-shiro/core`) y luego
ejecuta `format:check`, `lint`, `typecheck`, `test`, `build`, `test:scripts` y
`agents:check` (que comprueba que AGENTS.md coincide con lo que genera
CLAUDE.md: si tocas un bloque marcado con `agents-md`, ejecuta
`npm run agents:sync`). Compilar core primero es obligatorio: los demás
paquetes leen sus tipos de `packages/core/dist`, que no se versiona. El CI
ejecuta además `npm run audit:prod` (avisos `high` o `critical` en
dependencias de producción), que necesita red.

## Calidad de código

- TypeScript **strict**. Sin `any` salvo justificación clara.
- ESM en todos los paquetes (`"type": "module"`).
- Cada módulo del core **implementa una interfaz** en `packages/core/src/interfaces/`.
- Comunicación entre módulos **vía EventBus** — nunca llamadas directas. Ver [ADR 0001](docs/adr/0001-arquitectura-modular-event-driven.md).
- Eventos del bus tipados con generics. Naming: `<modulo>:<verbo>` (p.ej. `stt:transcribed`, `llm:chunk`).
- Tests con **Vitest**. Cobertura objetivo > 80% en `packages/core/`.
- Validación de configs YAML en runtime con **zod**.

## Lo que NO se commitea

- Archivos del **Live2D Cubism SDK Core** (`Live2DCubismCore.js`/`.dll`).
  Son propietarios. Cada dev los descarga manualmente.
- Modelos pesados o propietarios: `.moc3`, `.cmo3`, `.gguf`, `.bin`.
- **API keys**. Todo en `.env` o `secrets.env` (no trackeados), nunca hardcodeado.
- `node_modules/`, `dist/`, `coverage/` (ya en `.gitignore`).

## Idioma

- **Documentación, comentarios, mensajes de commit, ADRs**: en español.
- **Identificadores de código** (clases, funciones, variables, eventos, archivos): en inglés.

Ejemplo:

```ts
// Procesa una transcripción y dispara el evento llm:responded
class LLMModule {
  async generateResponse(text: string): Promise<string> {
    // ...
  }
}
```

<!-- agents-md:end -->

## Si tienes dudas

1. Mira si existe un ADR en `docs/adr/` que cubra el tema.
2. Si no existe y la duda es sobre arquitectura, **pregunta al usuario antes de inventar**.
3. Si descubres que una decisión vieja no tiene ADR pero merecía uno, propón escribir un ADR retrospectivo (Status `Accepted`, fecha real del momento en que se decidió).
