/**
 * Logger custom para Proyecto Shiro.
 *
 * Patrón: cada Logger es un objeto inmutable con un nivel umbral y un
 * contexto preasignado. `child()` devuelve un nuevo Logger con contexto
 * extendido — sin mutación, sin estado global, sin singletons.
 *
 * Universal por diseño: funciona en Node (console escribe a stdout/stderr)
 * y en navegador (console va a DevTools). La lectura de `LOG_LEVEL` desde
 * env vars está guardada para no romper en browser.
 *
 * Ver ADR 0004 (logger custom) y ADR 0011 (split browser/Node — Logger
 * universal).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Orden numérico de los niveles. Cuanto más alto el número, más severo.
 * Un Logger con threshold N solo emite mensajes de nivel >= N.
 */
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type LogContext = Record<string, unknown>;

/**
 * Lee `LOG_LEVEL` del entorno cuando estamos en Node. En browser devuelve
 * 'info' silenciosamente — el cliente puede sobrescribir con el constructor.
 *
 * El check `typeof process !== 'undefined'` evita el `ReferenceError` en
 * browser donde `process` no existe (Vite a veces lo polyfillea pero no
 * dependemos de eso).
 */
function readEnvLevel(): LogLevel {
  if (typeof process === 'undefined') return 'info';
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

export class Logger {
  private readonly level: LogLevel;
  private readonly threshold: number;
  private readonly context: LogContext;

  constructor(level: LogLevel = readEnvLevel(), context: LogContext = {}) {
    this.level = level;
    this.threshold = LEVEL_ORDER[level];
    this.context = context;
  }

  /**
   * Devuelve un nuevo Logger con el contexto extendido. El nivel se hereda.
   * Útil para que cada módulo del core tenga su propio prefijo sin compartir
   * estado mutable.
   *
   * @example
   *   const moduleLogger = rootLogger.child({ module: 'EventBus' });
   *   moduleLogger.info('listo'); // ... INFO  [module=EventBus] listo
   */
  child(context: LogContext): Logger {
    return new Logger(this.level, { ...this.context, ...context });
  }

  debug(msg: string, payload?: object): void {
    this.write('debug', msg, payload);
  }

  info(msg: string, payload?: object): void {
    this.write('info', msg, payload);
  }

  warn(msg: string, payload?: object): void {
    this.write('warn', msg, payload);
  }

  error(msg: string, payload?: object): void {
    this.write('error', msg, payload);
  }

  /**
   * Único método que toca el sink. Filtra por nivel y formatea la línea.
   *
   * Usa `console.*` (universal en Node y browser). En Node, `console.debug`
   * y `console.info` van a stdout; `console.warn` y `console.error` a stderr.
   * En browser todos van a DevTools, con un styling sutil del propio
   * console por nivel.
   */
  private write(level: LogLevel, msg: string, payload?: object): void {
    if (LEVEL_ORDER[level] < this.threshold) return;

    const timestamp = new Date().toISOString();
    const levelTag = level.toUpperCase().padEnd(5);
    const ctxStr = formatContext(this.context);
    const payloadStr = payload ? ` ${safeStringify(payload)}` : '';
    const line = `${timestamp} ${levelTag} ${ctxStr}${msg}${payloadStr}`;

    const sink = console[level];
    sink(line);
  }
}

function formatContext(ctx: LogContext): string {
  const entries = Object.entries(ctx);
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => `${k}=${formatValue(v)}`);
  return `[${parts.join(' ')}] `;
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return safeStringify(v);
}

/** Máximo de líneas del stack que se vuelcan al log. */
const MAX_STACK_LINES = 10;
/** Profundidad máxima de la cadena `cause` (y de `AggregateError.errors`). */
const MAX_CAUSE_DEPTH = 3;
/** Longitud máxima de las cadenas copiadas de un error (propiedades propias). */
const MAX_PROP_LENGTH = 500;

/**
 * Convierte un Error en un objeto plano serializable: `{ name, message, stack,
 * ...propias, cause?, errors? }`. `JSON.stringify` convierte cualquier Error
 * en `{}` porque sus propiedades no son enumerables.
 *
 * - `stack` se recorta a `MAX_STACK_LINES` líneas.
 * - `cause` y `errors` (AggregateError) recursan hasta `MAX_CAUSE_DEPTH`; `seen`
 *   guarda la ruta actual para cortar ciclos con '[circular]'.
 * - De las propiedades propias enumerables (`code`, `status`, `errno`…) solo se
 *   copian las primitivas: un objeto (cabeceras, cuerpos) podría llevar secretos.
 */
function serializeError(err: Error, depth: number, seen: WeakSet<object>): unknown {
  if (seen.has(err)) return '[circular]';
  if (depth > MAX_CAUSE_DEPTH) return '[truncated]';
  seen.add(err);
  try {
    const out: Record<string, unknown> = {
      name: err.name,
      message: err.message,
    };
    if (typeof err.stack === 'string') {
      out.stack = err.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n');
    }
    for (const [key, value] of Object.entries(err)) {
      if (Object.hasOwn(out, key) || key === 'cause' || key === 'errors') continue;
      if (typeof value === 'string') {
        out[key] = clipString(value);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value;
      }
    }
    if (err.cause !== undefined) {
      out.cause = summarizeNested(err.cause, depth + 1, seen);
    }
    if (err instanceof AggregateError) {
      out.errors = (err.errors as unknown[]).map((e) => summarizeNested(e, depth + 1, seen));
    }
    return out;
  } finally {
    seen.delete(err);
  }
}

/** Recorta una cadena a `MAX_PROP_LENGTH` caracteres. */
function clipString(s: string): string {
  return s.length > MAX_PROP_LENGTH ? `${s.slice(0, MAX_PROP_LENGTH)}…` : s;
}

/**
 * Resume una `cause` o un elemento de `errors`: los Error se serializan; las
 * primitivas y null pasan tal cual; cualquier objeto se sustituye por un
 * marcador para no volcar cabeceras o cuerpos (y evitar ciclos fuera de Error).
 */
function summarizeNested(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value instanceof Error) return serializeError(value, depth, seen);
  if (typeof value === 'string') return clipString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return '[object]';
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_key, value: unknown) =>
      value instanceof Error ? serializeError(value, 0, new WeakSet()) : value,
    );
  } catch {
    return '[unserializable]';
  }
}
