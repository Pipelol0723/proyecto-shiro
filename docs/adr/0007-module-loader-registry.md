# ADR 0007: ModuleLoader con factory registry

- **Status**: Accepted
- **Fecha**: 2026-05-26
- **Decidido por**: Pipelol0723

## Contexto

El config (`modules.config.yaml`) referencia implementaciones concretas
por nombre de clase string:

```yaml
modules:
  llm:
    local:
      active: OllamaLLM
    cloud:
      active: AnthropicLLM
  tts:
    active: ElevenLabsTTS
    fallback_chain:
      - KokoroTTS
      - SystemTTS
```

El `ModuleLoader` (Fase 1B) necesita convertir esos strings en
**instancias reales de clases** que implementen las interfaces
correspondientes (`ILLMModule`, `ITTSModule`, etc., ver ADR 0001).

Hay que decidir cómo se conecta "nombre en YAML" → "clase importada".
Hay opciones que van desde simple/manual hasta dinámico/mágico.

## Decisión

**Factory registry**: el `ModuleLoader` mantiene un mapa explícito
`string → factory function` poblado al arranque. Cada paquete o módulo
del core que aporta implementaciones se registra en este mapa.

Estructura:

```ts
type ModuleFactory<T> = (config: unknown, deps: ModuleDeps) => T;

class ModuleLoader {
  private factories = new Map<string, ModuleFactory<unknown>>();

  register<T>(name: string, factory: ModuleFactory<T>): void { ... }
  load<T>(name: string, config: unknown): T { ... }
}
```

Uso típico al arranque (en `packages/core/src/index.ts` o un archivo
de bootstrap):

```ts
import { ModuleLoader } from './core/module-loader.js';
import { OllamaLLM } from './modules/llm/ollama-llm.js';
import { ElevenLabsTTS } from './modules/tts/eleven-labs-tts.js';
// ...

const loader = new ModuleLoader({ logger });
loader.register('OllamaLLM', (cfg, deps) => new OllamaLLM(cfg, deps));
loader.register('ElevenLabsTTS', (cfg, deps) => new ElevenLabsTTS(cfg, deps));
// ...el resto
```

Después, el `Orchestrator` consume el config validado y pide instancias
al `ModuleLoader`:

```ts
const llmLocal = loader.load<ILLMModule>(
  config.modules.llm.local.active,
  config.modules.llm.local.config,
);
```

En Fase 1B no hay implementaciones reales todavía — el registry se
poblará desde Fase 2 en adelante. Los tests integration de Fase 1B
usan **mock modules** registrados igualmente.

## Alternativas consideradas

- **Dynamic import por nombre** (`await import(\`./modules/llm/\${name}.ts\`)`):
  descartado. **Riesgos**:
  - Path traversal: si el config viene de fuente no confiable, podría
    cargar archivos arbitrarios.
  - Bundlers (Tauri/webpack) no resuelven imports dinámicos con strings
    bien — terminas necesitando un manifiesto de igual modo.
  - El compilador TS no sabe qué tipos vienen → mucho `any`.
- **Decorators de registro** (`@RegisterModule('OllamaLLM')`):
  descartado. Decorators de TS aún son experimentales para el caso
  general (`stage-3` proposal); necesitan `experimentalDecorators` o
  TC39 decorators con cambios de sintaxis. Añade complejidad de tooling
  sin ganancia clara sobre el registry explícito.
- **Switch / if-else manual** dentro del loader:
  ```ts
  switch (name) {
    case 'OllamaLLM': return new OllamaLLM(...);
    case 'ElevenLabsTTS': return new ElevenLabsTTS(...);
    // ...
  }
  ```
  descartado. Funciona pero el `ModuleLoader` termina conociendo a
  TODOS los módulos del proyecto. Acoplamiento alto, difícil de
  extender desde paquetes externos (futuro: un `plugin` podría
  registrarse en runtime).
- **Service locator / DI container** (InversifyJS, tsyringe):
  descartado. Overkill para nuestro caso. Añade peso y ceremonia para
  resolver lo que un Map con register/load resuelve en 30 líneas.

## Consecuencias

### Positivas

- **Explícito**: alguien tiene que llamar a `loader.register(name, factory)`
  para que un módulo esté disponible. Cero magia.
- **Type-safe**: `register<T>` y `load<T>` aceptan el tipo concreto,
  el llamador sabe qué interfaz recibe.
- **Extensible**: cualquier paquete (incluso plugins externos en Fase 8)
  puede registrar sus propios módulos.
- **Testeable**: los tests registran mocks (`MockLLM`) por los mismos
  nombres que la app real. La diferencia entre prod y test es solo qué
  factories están registradas.
- **Bundler-friendly**: imports estáticos normales. Tauri/Vite los
  manejan sin sufrir.

### Negativas / Riesgos

- **Duplicación de nombres**: el string en el YAML debe coincidir con
  el nombre registrado. Un typo en cualquier lado rompe el load.
  Mitigación: el ConfigLoader (ADR 0006) puede validar contra una lista
  de nombres registrados emitiendo un error claro.
- **Boilerplate**: hay que llamar a `register` por cada módulo en
  algún sitio. Aceptable — el sitio se llama "bootstrap" y se puede
  organizar por subdirectorio.

### Neutrales

- El "factory" recibe `(config, deps)` donde `deps` incluye el `logger`,
  `bus` y otros singletons. Conviene fijar la forma de `ModuleDeps`
  pronto para no ir cambiándola.

## Notas de implementación

- `packages/core/src/core/module-loader.ts`.
- Factory signature: `(config: unknown, deps: ModuleDeps) => T`.
- `ModuleDeps` mínimo: `{ logger: Logger; bus: IEventBus }`. Extensible.
- El `load` aplica el factory y devuelve la instancia tipada.
- Tests en `packages/core/tests/integration/` registran mocks de los
  módulos correspondientes y verifican el flujo completo.

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — los módulos
  implementan interfaces; el loader es lo que les da vida desde config.
- [ADR 0006](0006-config-validation-zod.md) — el config validado es
  lo que el loader consume.
