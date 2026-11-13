# Instrucciones para agentes (Codex y otros) — Proyecto Shiro

> **Extracto de [`CLAUDE.md`](CLAUDE.md)**, que es la única fuente de instrucciones para agentes: si algo difiere, manda CLAUDE.md ([ADR 0029](docs/adr/0029-proceso-de-mantenimiento-de-una-persona.md)). Hoy este extracto se mantiene a mano; un script lo comprobará (ítem P-19b del [plan de mejora](docs/plan-mejora-2026-11.md), sin implementar). Cambia primero CLAUDE.md y luego este archivo.

## Qué es

AI Companion modular tipo VTuber con voz, memoria y avatar animado. Lo mantiene una persona, 4-6 h/semana, con agentes de IA como apoyo. Hardware de desarrollo: un portátil con una GTX 1650 de 4 GB.

El estado de los hitos y la hoja de ruta viven **solo** en la tabla [Roadmap del README](README.md#roadmap). Lo que toca ahora es el plan de mejora: la Fase 1 está aprobada desde el 2026-11-13 y en ejecución; las demás fases, pendientes de aprobación.

Antes de algo estructural, lee CLAUDE.md, [`docs/architecture.md`](docs/architecture.md) y [`docs/adr/`](docs/adr/). Antes de tocar fronteras de confianza, lee la tabla SEC-xx de [`docs/security-review-2026-07.md`](docs/security-review-2026-07.md) y [ADR 0027](docs/adr/0027-autenticacion-token-bus-stt-multicliente.md) (Accepted, sin implementar).

## Reglas duras

- Nadie pushea directo a `main` ni a `develop`: todo entra por PR con base `develop`.
- `develop` es la única rama de integración. Las versiones son tags `vX.Y.Z` sobre `develop`; `main` solo avanza al publicar un tag, por fast-forward hasta ese tag.
- PR de agente: cita el lote `L-xxx` y los `R-xxx` que cierra, diff de 300 líneas como máximo, test rojo→verde y checks en verde. Como mucho 2 PRs de agente abiertos a la vez.
- Propón un ADR antes de implementar si el cambio afecta a más de un paquete, es caro de revertir, mete o quita una dependencia importante, fija un patrón que otros seguirán o alguien preguntará en 3 meses por qué se hizo así. Un ADR nuevo va en un PR `docs:` propio, fusionado antes que su código; la enmienda de uno existente va con el código que la cumple. Los ADR no se reescriben.
- Nunca se commitean el Cubism Core (`Live2DCubismCore.js`/`.dll`), modelos (`.moc3`, `.cmo3`, `.gguf`, `.bin`), API keys, `.env`, `secrets.env`, `node_modules/`, `dist/` ni `coverage/`.
- Documentación, comentarios, commits y ADR en español; identificadores de código en inglés.
- Prefijos de commit (minúscula + `:`): `feat:`, `fix:`, `test:`, `docs:`, `refac:`, `chore:`, `ci:`.
- Los módulos se comunican por el EventBus, nunca con llamadas directas, y cada módulo del core implementa una interfaz de `packages/core/src/interfaces/`.
- TypeScript strict, ESM, configs YAML validadas con zod, tests con Vitest.

## Antes de pushear

Ejecuta `npm run verify`. Si falla, no pushes.

```bash
npm run verify
```

Hace los mismos pasos que el CI, en el mismo orden: compila core y luego
ejecuta `format:check`, `lint`, `typecheck`, `test`, `build` y `test:scripts`.
El CI ejecuta además `npm run audit:prod`, que necesita red.
