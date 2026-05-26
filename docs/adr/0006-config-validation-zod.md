# ADR 0006: Validación de configuración con zod

- **Status**: Accepted
- **Fecha**: 2026-05-26
- **Decidido por**: Pipelol0723

## Contexto

El proyecto tiene dos archivos de configuración en `config/` que se leen
en runtime:

- `modules.config.yaml`: qué implementación concreta usar en cada slot
  (LLM local, LLM cloud, STT, TTS, memoria, avatar, router).
- `devices.config.yaml`: dispositivos IoT/Arduino registrados (placeholder
  en Fase 1, contenido real en Fase 11).

Adicionalmente, los archivos de personaje en
`packages/core/src/character/characters/<nombre>.yaml` también son
configuración estructurada.

**Riesgos sin validación**:

- Un typo en un campo (`actiev` en vez de `active`) hace que un módulo
  silenciosamente no se cargue. Difícil de depurar.
- Cambiar la forma del config en un commit y olvidar actualizar los
  archivos rompe el arranque sin error claro.
- Cargar el config como `unknown` y hacer casts a mano (`as ModulesConfig`)
  es la receta para bugs futuros — el "tipado" mentido no protege nada.

Hace falta una capa que en el arranque verifique que los YAMLs tienen
la forma esperada y, si no, falle con un mensaje accionable apuntando
al campo problemático.

## Decisión

**Usar [zod](https://zod.dev/) para definir schemas de cada YAML y
validar el contenido en runtime tras parsear con la librería `yaml`
(eemeli/yaml).**

Convención del flujo:

```ts
const raw = parse(readFileSync('config/modules.config.yaml', 'utf8'));
const config = ModulesConfigSchema.parse(raw); // ← falla aquí si inválido
// `config` es de tipo `z.infer<typeof ModulesConfigSchema>` — tipado real.
```

Los schemas viven en `packages/core/src/config/schemas.ts`. Los tipos
TS se derivan via `z.infer<typeof Schema>` — single source of truth.

**Convenciones aplicables a TODO runtime validation del proyecto**:

1. Todo input externo al core (archivos, requests HTTP futuros, mensajes
   de transports remotos) se valida con un schema zod antes de usarse.
2. Los tipos TS internos se infieren del schema (`z.infer`), nunca se
   declaran a mano duplicando información.
3. Errores de validación se atrapan en el punto de carga y se traducen
   a mensajes legibles para el dev/usuario (no se dejan escapar como
   excepciones de zod crudas en producción).

## Alternativas consideradas

- **ajv** (JSON Schema): excelente performance y estándar industria,
  pero los schemas se escriben como JSON Schema (verboso) y los tipos
  TS hay que generarlos con otra herramienta. zod integra schema +
  tipos en una sola fuente.
- **joi**: madurez sobrada, pero su soporte de TS es secundario
  (necesitas `@hapi/joi` types separados). Inferencia de tipos no
  es nativa.
- **valibot**: nueva, más rápida y con menor bundle size que zod.
  Descartada por **madurez**: zod tiene años en producción, ecosistema
  enorme (tRPC, hono, ts-rest, drizzle-zod). Para un proyecto que va a
  vivir años, estabilidad gana.
- **Validación manual** (`if (!config.modules) throw`): descartada.
  Cubre el 10% de casos en 10x el esfuerzo. Mensajes de error pobres.
- **Sin validación, casts manuales** (`config as ModulesConfig`):
  descartado. Es lo equivalente a no tener tipos.

## Consecuencias

### Positivas

- **Mensajes de error útiles**: zod reporta exactamente qué campo
  falló y por qué (`modules.llm.local.model: Expected string, received
number at path "modules.llm.local.model"`).
- **Single source of truth**: el schema ES el tipo. Si añades un campo
  al schema, TS lo conoce automáticamente.
- **Composición**: schemas pequeños se combinan en grandes
  (`ModulesConfigSchema = z.object({ modules, character })`).
- **Validación reusable**: los mismos schemas validan archivos YAML hoy,
  y mañana validarán payloads de eventos entrantes desde WebSocket
  (ver ADR 0005).

### Negativas / Riesgos

- **Dependencia nueva**: zod (~10kb minified). Aceptable — la
  alternativa es complejidad propia.
- **Curva de aprendizaje** menor para quien no la conoce. Mitigada por
  la documentación excelente de zod y por uso amplio en la industria.
- **Performance**: parsear un YAML pequeño con zod es ~ms. Irrelevante
  para arranque, podría importar si validáramos millones de eventos/s
  (no nuestro caso).

### Neutrales

- También se añade la dependencia `yaml` (eemeli/yaml) para el parser
  YAML — alternativa `js-yaml` también es válida, pero `yaml` tiene
  mejor soporte de TS y syntax YAML 1.2. Elección por defecto, no
  fundamental.

## Notas de implementación

- Schemas en `packages/core/src/config/schemas.ts`.
- ConfigLoader en `packages/core/src/config/config-loader.ts` — lee
  archivo, parsea YAML, valida con schema, devuelve tipo inferido.
- Errores de validación: el ConfigLoader atrapa `ZodError` y lo
  re-lanza como `ConfigValidationError` con el path + mensaje legible.
- En el arranque, fallar rápido y claro vale más que intentar
  recuperarse. Si el config es inválido, la app no arranca.

## Referencias

- [zod docs](https://zod.dev/)
- [yaml (eemeli/yaml)](https://eemeli.org/yaml/)
- [ADR 0005](0005-typed-events-string-literals.md) — sienta la idea de
  schemas para eventos entrantes de transports remotos (futuro).
