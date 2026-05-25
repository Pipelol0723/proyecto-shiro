# ADR 0004: Logger custom sin dependencias

- **Status**: Accepted
- **Fecha**: 2026-05-25
- **Decidido por**: Pipelol0723

## Contexto

Todos los módulos del core (`EventBus`, `Orchestrator`, módulos LLM/TTS/STT
etc.) necesitan loguear información: debug interno durante desarrollo,
warnings de operación, errores recuperables y fatales.

Sin un logger común, cada módulo terminaría usando `console.log` con
formatos distintos, sin niveles, sin contexto. Imposible filtrar o
postprocesar en producción.

[ADR 0001](0001-arquitectura-modular-event-driven.md) estableció que el
proyecto valora aprender la construcción de primitivas básicas (custom
EventBus en lugar de mitt). El mismo principio aplica al logger.

Adicionalmente, el companion va a correr inicialmente en local; no
necesita transports remotos, agregadores, ni features avanzadas (tracing,
sampling, structured logging para Elasticsearch). Esas necesidades, si
llegan, se evalúan con un ADR nuevo.

## Decisión

**Implementar un `Logger` custom** en `packages/core/src/core/logger.ts`.
Sin dependencias externas.

Características:

- **Cuatro niveles** estándar: `debug`, `info`, `warn`, `error`.
- **Filtrado por nivel** configurable, leído de `process.env.LOG_LEVEL`
  al arrancar (default: `info`).
- **Contexto via `child()`**: cada módulo crea su propio logger con
  contexto preasignado. Ejemplo: `logger.child({ module: 'EventBus' })`.
- **Salida a stdout/stderr** con formato legible: `timestamp ISO + nivel + contexto + mensaje + payload opcional`.
- **Tamaño objetivo**: ~50-70 líneas de TS.

## Alternativas consideradas

- **pino**: estándar de facto en Node, muy rápido, JSON estructurado.
  Descartado por: añade dependencia, su API es más rica de lo que
  necesitamos hoy. **Si en algún momento necesitamos JSON structured
  logging para parsear en producción, se evalúa migrar con un nuevo
  ADR.** La interfaz del logger custom está pensada para ser fácil de
  reemplazar.
- **winston**: similar a pino pero más antiguo y más lento. Descartado
  por las mismas razones.
- **Wrapper sobre `console`**: descartado. No tener niveles ni filtrado
  estructurado hace que en dos meses el output sea ruido.
- **debug (TJ Holowaychuk)**: minimalista pero centrado en namespaces
  más que en niveles. No encaja con nuestra necesidad de levels.

## Consecuencias

### Positivas

- **Cero dependencias** de logging en el árbol.
- **Aprendizaje**: el usuario entiende cómo se construye un logger por
  dentro. Las decisiones (formato de output, manejo de errores) son
  suyas.
- **Interfaz mínima**: ningún módulo se acopla a APIs propietarias de
  una librería.
- **Migración futura sencilla** si se necesita JSON structured: la API
  pública (`debug`, `info`, `warn`, `error`, `child`) es estándar y
  se puede re-implementar sobre pino sin tocar los call sites.

### Negativas / Riesgos

- **No tendremos rotación de logs**, transports a syslog, ni
  serialización JSON sofisticada. Cuando el proyecto las pida, hay que
  decidir entre extender el logger o migrar.
- **No tan rápido como pino**. En la práctica, irrelevante: nuestra app
  no procesa millones de logs/s.

### Neutrales

- El logger se instancia en el arranque y se inyecta como dependencia
  a los módulos que lo necesitan (no es global ni singleton).

## Notas de implementación

- Ubicación: `packages/core/src/core/logger.ts`.
- Interfaz mínima:
  ```ts
  type Level = 'debug' | 'info' | 'warn' | 'error';
  interface Logger {
    debug(msg: string, ctx?: object): void;
    info(msg: string, ctx?: object): void;
    warn(msg: string, ctx?: object): void;
    error(msg: string, ctx?: object): void;
    child(context: object): Logger;
  }
  ```
- Configuración de nivel:
  - `LOG_LEVEL=debug npm test` → muestra todos.
  - Default: `info`.
- Formato de salida (legible):
  ```
  2026-05-25T12:34:56.789Z INFO  [EventBus] handler registered { event: 'llm:chunk' }
  ```

## Referencias

- [ADR 0001](0001-arquitectura-modular-event-driven.md) — política
  de "primitivas custom para aprender" cuando es razonable.
- pino: https://github.com/pinojs/pino (alternativa rechazada).
