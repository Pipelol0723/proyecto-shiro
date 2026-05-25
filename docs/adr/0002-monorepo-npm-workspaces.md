# ADR 0002: Monorepo con npm workspaces

- **Status**: Accepted
- **Fecha**: 2026-05-25
- **Decidido por**: Pipelol0723

## Contexto

Inicialmente el proyecto se planeó como una app desktop Tauri monolítica:
un solo paquete que contiene el cerebro y la UI.

Al revisar el alcance, el usuario aclaró que el companion **no es solo
una app desktop**. A medio/largo plazo necesita:

- App móvil que se conecte al companion desde el sofá.
- Integración con Arduino (sensores, motores) vía USB o WiFi.
- Robots simples controlados por el companion.
- Eventualmente IoT (luces, sensores Home Assistant).

Esos clientes no viven dentro de la app desktop. Necesitan **conectarse**
a un cerebro que corra como servicio independiente.

Si el cerebro está acoplado a la UI desktop (un solo `package.json`,
todo en `src/`), añadir un cliente móvil más adelante implica:

- O bien duplicar lógica (mal),
- O bien hacer un refactor masivo extrayendo el core (peor cuanto más
  tarde se haga).

## Decisión

**Monorepo con npm workspaces**, organizado por paquetes según su
responsabilidad:

```
packages/
├── core/      → @proyecto-shiro/core    (cerebro headless)
└── desktop/   → @proyecto-shiro/desktop (cliente Tauri, Fase 7)
```

Futuros paquetes previstos cuando lleguen:

- `packages/mobile/` — cliente móvil
- `packages/arduino-bridge/` — puente Serial/USB
- `packages/iot-bridge/` — puente MQTT/Home Assistant

El **tooling se comparte en la raíz** (TypeScript base config, ESLint,
Prettier, Vitest workspace). Cada paquete tiene su propio `package.json`,
`tsconfig.json`, `vitest.config.ts`.

## Alternativas consideradas

- **Monolito** (`src/` único en la raíz): descartado por las razones del
  contexto. Refactor a monorepo cuando ya hay 6+ módulos es mucho peor
  que hacerlo desde el inicio.
- **Pnpm o Yarn workspaces**: descartado. Funcionalmente equivalentes
  para nuestro caso. npm workspaces viene con npm sin instalación extra
  y es lo bastante bueno. Si en algún momento pnpm ofrece algo crítico
  (mejor caching, deduplicación), migrar es trivial (cambiar el
  package.json del root y reinstalar).
- **Múltiples repositorios separados** (polyrepo): descartado. Para un
  equipo de 2 personas, monorepo es más simple. Polyrepo tiene sentido
  cuando los paquetes evolucionan a distintas velocidades por equipos
  distintos.

## Consecuencias

### Positivas

- El core puede ejecutarse como **servicio standalone** (sin UI).
  Esto es lo que habilita móvil, Arduino, etc.
- Cada paquete declara sus dependencias específicas (el desktop
  cargará Tauri, el core no necesita Tauri).
- `npm install` desde la raíz instala todo y crea links automáticos
  entre paquetes (`@proyecto-shiro/desktop` ve a `@proyecto-shiro/core`
  como dependencia local).
- CI se mantiene simple: un solo workflow que lintea y testea todo.

### Negativas / Riesgos

- Más archivos de config (tsconfig por paquete, vitest.config por
  paquete). Mitigado con `tsconfig.base.json` compartido.
- Path resolution en ESLint requiere `projectService: true` para
  autodetectar el tsconfig correcto por paquete (ya configurado).
- Si un paquete depende de otro en el monorepo, hay que tener cuidado
  con el orden de build. Mitigado dejando que npm workspaces resuelva
  los links via `*` y construyendo desde el paquete dependiente.

### Neutrales

- Los imports cruzados entre paquetes serán como `import { X } from
'@proyecto-shiro/core'` — explícitos y trackeables.

## Notas de implementación

- Root `package.json` define `"workspaces": ["packages/*"]`.
- Scripts del root delegan a workspaces:
  `npm run typecheck` → `npm run typecheck --workspaces --if-present`.
- `tsconfig.base.json` en root tiene los compiler options compartidos.
  Cada paquete extiende: `"extends": "../../tsconfig.base.json"`.
- `vitest.workspace.ts` en root lista los `vitest.config.ts` por paquete.
- ESLint en root con `projectService: true` autodetecta el tsconfig
  correcto para cada archivo.

## Referencias

- [npm workspaces docs](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
- [ADR 0001](0001-arquitectura-modular-event-driven.md) — el monorepo
  es la consecuencia natural de querer múltiples clientes hablando con
  un mismo cerebro.
- [ADR 0003](0003-transport-abstraction-device-registry.md) — el modo
  como esos clientes se conectan al core.
