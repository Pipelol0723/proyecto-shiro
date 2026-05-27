# ADR 0011: Split del `@proyecto-shiro/core` en entries browser-safe vs Node-only

- **Status**: Accepted
- **Fecha**: 2026-05-26
- **Decidido por**: Pipelol0723

## Contexto

[ADR 0008](0008-cliente-desktop-vite-react.md) decidió construir el
cliente desktop con Vite + React + TS. Al intentar la primera
implementación (PR B) salió el problema:

El barrel `@proyecto-shiro/core` re-exporta `ConfigLoader` que importa
`node:fs` para leer YAML del disco. Vite no puede bundlear `node:fs`
para el navegador y aborta el build.

```
[vite] Module "node:fs" has been externalized for browser compatibility.
Cannot access "node:fs.readFileSync" in client code.
```

Workaround temporal en PR B: el cliente inlinea el tipo `Emotion`
localmente en lugar de importarlo del core. Funciona pero es deuda:

- Cada vez que el core añada un tipo público, el cliente lo duplica.
- Cuando llegue el cliente móvil (Fase 9) tendrá el mismo problema.
- Va contra [ADR 0010](0010-wiring-cliente-core-eventbus.md) que dice
  "el cliente importa EventBus, Logger, Orchestrator desde el core".

Hay que decidir cómo expone el core sus APIs para que **el código
browser-safe sea accesible sin arrastrar dependencias Node**.

### Diagnóstico

Solo **dos archivos** en el core usan APIs Node:

| Archivo                       | API                                                  | Portable a browser                            |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `src/config/config-loader.ts` | `import { readFileSync } from 'node:fs'`             | **No** — el cliente no debe leer YAML del FS  |
| `src/core/logger.ts`          | `process.env.LOG_LEVEL`, `process.stdout.write` etc. | **Sí** — `console.*` existe en ambos entornos |

Todo lo demás (EventBus, transports, ModuleLoader, Orchestrator,
interfaces, types, zod schemas) es **JavaScript puro**, sin
dependencias de Node.

## Decisión

**Dos cambios coordinados:**

### 1. Logger universal

Refactorizar `src/core/logger.ts` para que funcione en navegador y Node
sin cambios:

- Reemplazar `process.stdout/stderr.write(line + '\n')` por
  `console.{debug,info,warn,error}(line)`. En Node, `console.*` escribe
  a stdout/stderr. En browser, va a DevTools.
- Guardar la lectura de `process.env.LOG_LEVEL` detrás de
  `typeof process !== 'undefined'` para que no explote en browser.

La API pública (`debug`, `info`, `warn`, `error`, `child`) no cambia.

### 2. Subpath exports en el core

`packages/core/package.json` declara dos entries:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./node": {
      "types": "./dist/node.d.ts",
      "import": "./dist/node.js"
    }
  }
}
```

- **`@proyecto-shiro/core` (entry `.`)** — browser-safe. Exporta tipos,
  interfaces, EventBus, Logger (universal), InProcessTransport,
  ModuleLoader, Orchestrator, schemas zod (puros).
- **`@proyecto-shiro/core/node` (entry `./node`)** — Node-only. Exporta
  `ConfigLoader` y `ConfigValidationError`. Si en el futuro añadimos
  más utilidades de I/O (lectura de archivos de personaje, hash de
  modelos, etc.), van aquí.

Los **clientes** importan así:

```ts
// Cliente desktop (browser/Vite/Tauri renderer)
import { EventBus, Logger, Emotion } from '@proyecto-shiro/core';

// Scripts CLI o backend de Tauri (Node)
import { ConfigLoader } from '@proyecto-shiro/core/node';
import { EventBus } from '@proyecto-shiro/core'; // sigue funcionando
```

## Alternativas consideradas

- **Hacer `ConfigLoader` lazy / dynamic import**: descartado. Aunque
  evitaría el error de build, el código quedaría más enredado y no
  arregla el problema de que `node:fs` siga estando en el tree del
  bundle. Vite no sabría que no se va a ejecutar.
- **Extraer `ConfigLoader` a un paquete separado (`@proyecto-shiro/core-node`)**:
  descartado por ahora. Funcionalmente equivalente al subpath export
  pero crea otro `package.json` que mantener. El subpath export es la
  forma estándar de Node 16+ para esto, encaja perfecto.
- **Hacer browser-safe TODO incluyendo ConfigLoader** (usando `fetch`
  o `import.meta.glob`): descartado. El cliente desktop NO debería
  leer config del filesystem desde el navegador — eso lo hace el
  backend (Node process del Tauri, o el core como servicio). El
  cliente recibe la config ya parseada por IPC/WebSocket.
- **Mantener inline el tipo `Emotion` en cada cliente**: descartado.
  Deuda creciente y violación del DRY.
- **Cambiar Logger a usar `pino`**: descartado por
  [ADR 0004](0004-custom-logger.md) — `pino` añade dependencia. Pero
  hay una ventaja: pino ya tiene browser detection. Aún así, el
  refactor a `console.*` es minimal y mantiene el espíritu del ADR 0004.

## Consecuencias

### Positivas

- **El cliente desktop importa tipos y primitivas directamente** sin
  duplicar:
  ```ts
  import type { Emotion, EventMap, IEventBus } from '@proyecto-shiro/core';
  import { EventBus, Logger, InProcessTransport } from '@proyecto-shiro/core';
  ```
- **Vite/Rollup hacen tree-shaking correcto** porque el entry browser
  no menciona `node:fs`.
- **Cuando llegue el cliente móvil** (Fase 9), el mismo patrón sirve:
  importa de `@proyecto-shiro/core`, ignora `./node`.
- **Logger funciona en tests con DOM-like envs** (jsdom de Vitest) sin
  hacks. El cliente desktop podrá testear con jsdom directamente.
- **El patrón es extensible**: si necesitamos un entry `/electron` o
  `/tauri-renderer` con utilidades específicas, se añade al `exports`
  sin tocar el resto.

### Negativas / Riesgos

- **Si alguien importa de `@proyecto-shiro/core/node` desde código que
  termina en un bundle browser**, vuelve a romper el build. Mitigación:
  la convención + revisión de imports en code review. Eventualmente
  un test de CI que valide que el cliente no importa del entry `node`.
- **`Logger` con `console.*` pierde control fino del sink en Node**.
  Si en el futuro queremos rotación de logs o pipes a syslog,
  reescribimos el sink. La API pública sigue igual, los call sites no
  cambian.
- **El refactor de Logger toca los tests existentes**. Hay que mover
  los spies de `process.stdout.write` a `console.{info,debug,warn,error}`.

### Neutrales

- El `package.json` del core gana una sección `exports`. Esto **es** un
  cambio público de API en términos de package metadata, pero como el
  paquete es `private: true` no afecta a consumidores externos.
- Tests del core que usan `ConfigLoader` siguen importando desde
  `src/config/config-loader.js` directamente (no del entry `node`).
  No cambian.

## Notas de implementación

- `packages/core/src/index.ts`: quitar `export * from './config/index.js'`
  porque ese barrel exporta `ConfigLoader`. Sustituir por export
  explícito de schemas/types que sí son browser-safe.
- `packages/core/src/config/index.ts`: quitar el export de
  `ConfigLoader` y `ConfigValidationError`. Dejar solo schemas + types.
- `packages/core/src/node.ts` (nuevo): re-exporta `ConfigLoader` y
  `ConfigValidationError`. Si en el futuro hay más utilidades Node,
  van aquí.
- `packages/core/package.json`:
  - Mantener `main` y `types` para compatibilidad con tooling viejo.
  - Añadir `exports` con `.` y `./node`.
- `packages/core/tsconfig.build.json`: el `include` actual ya cubre
  todo `src/**/*.ts`, así que `node.ts` se compila sin cambios.
- **Tests del Logger** (`packages/core/tests/unit/core/logger.test.ts`):
  cambiar spies de `process.stdout/stderr.write` a
  `console.{debug,info,warn,error}`.
- **Cliente desktop** (`packages/desktop/src/components/Orb/types.ts`):
  reemplazar el `type Emotion` inline por
  `import type { Emotion } from '@proyecto-shiro/core'`.

## Referencias

- [ADR 0004](0004-custom-logger.md) — Logger custom, ahora portable.
- [ADR 0008](0008-cliente-desktop-vite-react.md) — el cliente que
  motivó este split.
- [ADR 0010](0010-wiring-cliente-core-eventbus.md) — describe los
  imports esperados del cliente, que este ADR habilita.
- Node.js docs sobre subpath exports:
  https://nodejs.org/api/packages.html#subpath-exports
