# ADR 0008: Cliente desktop con Vite + React + TypeScript

- **Status**: Accepted
- **Fecha**: 2026-05-26
- **Decidido por**: Pipelol0723

## Contexto

Hasta este momento, `packages/desktop/` es un skeleton vacío. El plan
original (`plan-modular-ai-companion.md`) lo dejaba para Fase 7 como
"empaquetado con Tauri". Pero hablando con el usuario surgieron dos
realidades:

1. **No hay forma de interactuar con el companion** mientras se construyen
   las Fases 2-6. Eso bloquea testing manual durante meses.
2. **Existe ya un mockup completo** generado con Claude Design (ver
   [`docs/design-mockup/`](../design-mockup/)) que diseña 5 pantallas
   con tres variantes visuales. El mockup está escrito en React (vía
   Babel Standalone en navegador, formato no-producción) y consume el
   pattern del EventBus 1:1.

Esto cambia el rol del cliente desktop: deja de ser "el bonito final
en Fase 7" y pasa a ser **el dogfood durante todo el desarrollo**. Cada
módulo nuevo (Ollama, ElevenLabs, Whisper, etc.) se enchufa al cliente
que ya existe y se valida visualmente.

Hay que decidir el stack del cliente real antes de codear nada.

## Decisión

**Stack del cliente desktop: `Vite + React 18 + TypeScript strict`.**

Ubicación: `packages/desktop/`. Consume `@proyecto-shiro/core` como
dependencia de workspace.

Detalles concretos:

- **Bundler**: Vite 6+ (dev server con HMR, build con Rollup).
- **UI lib**: React 18 (la misma que el mockup).
- **Lenguaje**: TypeScript strict, mismas reglas que el core
  (`tsconfig.base.json` extendido).
- **Estilado**: CSS Modules + CSS vars (no Tailwind, no styled-components).
  Los tres temas (kawaii/cyber/editorial) viven como conjuntos de CSS
  vars idénticos al mockup.
- **Fuentes**: paquetes `@fontsource/*` (no CDN). Queremos que la app
  funcione offline.
- **Empaquetado a binario** (Fase 7 original): Tauri 2.0 envuelve el
  build de Vite. Tauri se decide formalmente cuando lleguemos, no
  cambia el resto del stack.

## Alternativas consideradas

- **Vanilla HTML + JS**: descartado. El diseño tiene state complejo
  (reducer con 12 acciones, 5 pantallas, animaciones reactivas).
  Reescribir esto en vanilla es 3x más código y peor de mantener.
- **Svelte / SolidJS / Vue**: descartado por dos razones. (1) El mockup
  ya está en React — convertirlo cuesta tiempo y pierde la garantía de
  fidelidad pixel-perfect. (2) Ninguna ventaja decisiva para este caso
  (no SSR, no SEO, no bundle size crítico). Si la ventaja fuera grande
  (e.g. performance crítico), valdría la pena reescribir. No lo es.
- **Next.js**: descartado. Es un framework de aplicaciones full-stack
  (SSR, rutas, etc.). Una desktop app no necesita server. Sería overhead.
- **Webpack en lugar de Vite**: descartado. Vite es estándar moderno,
  build 10-20x más rápido en dev, ESM-native (encaja con el core).
- **Babel Standalone en el navegador** (como hace el mockup): descartado
  obviamente. No es producción. Se usa solo para prototipar.
- **Posponer todo hasta Fase 7**: descartado por la razón del contexto.
  Es lo que nos llevó a tener el cerebro sin manos.

## Consecuencias

### Positivas

- **Visual desde día uno**: cada vez que se completa un módulo, se ve en
  la UI del cliente. Motivación + validación temprana.
- **Migración trivial del mockup**: el diseño está en React, mantener
  React reusa el 90% del trabajo conceptual y visual.
- **Tauri compatible**: Tauri 2.0 abraza Vite oficialmente. Empaquetar
  más adelante es configuración, no reescritura.
- **Ecosistema rico**: React + Vite + TS es probablemente el stack más
  cubierto del mundo. Cualquier problema tiene Stack Overflow.

### Negativas / Riesgos

- **Una dependencia más de mantenimiento**: React tiene major versions
  cada ~2 años. Mitigación: los upgrades son tipicamente smooth.
- **Bundle más grande que vanilla**: ~50KB gzipped React 18 + ReactDOM.
  Aceptable para una desktop app, irrelevante en local.
- **Más superficie para aprender**: el usuario quiere aprender — React
  es buena cosa para aprender pero añade horas. Mitigación: usar
  patrones simples (sin Redux, sin React Query, sin Recoil — solo
  useReducer + useEffect + custom hooks).

### Neutrales

- El paquete `@proyecto-shiro/desktop` será el primer cliente concreto.
  Esto **establece el patrón** que otros clientes (mobile en Fase 9,
  web en Fase 4-5 si lo añadimos) seguirán: cada uno con su stack pero
  consumiendo el mismo `@proyecto-shiro/core`.
- Las **3 variantes visuales** (kawaii / cyber / editorial) se
  mantienen swap-eables en producción, no solo en el mockup. Ver
  ADR 0009 sobre cómo se implementan.

## Notas de implementación

- `packages/desktop/package.json`:
  - `@proyecto-shiro/core: "*"` (workspace link)
  - `react`, `react-dom`, `@types/react`, `@types/react-dom`
  - `@fontsource/quicksand`, `@fontsource/space-grotesk`,
    `@fontsource/cormorant-garamond`, `@fontsource/manrope`,
    `@fontsource/jetbrains-mono`
- `packages/desktop/tsconfig.json`: extiende `tsconfig.base.json`, añade
  `jsx: "react-jsx"` y `types: ["vite/client"]`.
- `packages/desktop/vite.config.ts`: configuración Vite con React plugin
  y alias hacia el core.
- `packages/desktop/index.html`: entry HTML mínimo que Vite procesa.
- `packages/desktop/src/main.tsx`: punto de entrada React.
- ESLint flat config (root): añadir bloque para archivos `.tsx` con
  parser-options para JSX.
- CI workflow: el build de desktop se añade a la matriz cuando exista
  código real (siguiente PR).

## Referencias

- [ADR 0002](0002-monorepo-npm-workspaces.md) — el monorepo donde vive
  este paquete.
- [ADR 0003](0003-transport-abstraction-device-registry.md) — cómo este
  cliente se cablea al core (vía un Transport en el futuro, en-proceso
  por ahora).
- [ADR 0009](0009-orbe-placeholder-avatar.md) — el orbe visual del
  cliente hasta Fase 6.
- [ADR 0010](0010-wiring-cliente-core-eventbus.md) — el pattern concreto
  de cómo el state del cliente sincroniza con el EventBus.
- [`docs/design-mockup/`](../design-mockup/) — bundle del diseño que
  guía la implementación pixel-perfect.
- Vite: https://vitejs.dev/
- Tauri 2.0: https://v2.tauri.app/
