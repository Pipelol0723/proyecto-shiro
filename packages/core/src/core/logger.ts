/**
 * Logger custom para Proyecto Shiro.
 *
 * Patrón: cada Logger es un objeto inmutable con un nivel umbral y un
 * contexto preasignado. `child()` devuelve un nuevo Logger con contexto
 * extendido — sin mutación, sin estado global, sin singletons.
 *
 * Ver ADR 0004 (`docs/adr/0004-custom-logger.md`).
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
 * Lee `LOG_LEVEL` del entorno. Valores válidos: debug | info | warn | error.
 * Cualquier otro valor (o ausente) cae a 'info' silenciosamente.
 */
function readEnvLevel(): LogLevel {
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
   * Único método que toca stdout/stderr. Filtra por nivel y formatea la línea.
   * Mantenerlo aislado facilita el test (sustituyendo el sink) y un refactor
   * futuro a pino sin cambiar la API pública.
   */
  private write(level: LogLevel, msg: string, payload?: object): void {
    if (LEVEL_ORDER[level] < this.threshold) return;

    const timestamp = new Date().toISOString();
    const levelTag = level.toUpperCase().padEnd(5);
    const ctxStr = formatContext(this.context);
    const payloadStr = payload ? ` ${safeStringify(payload)}` : '';
    const line = `${timestamp} ${levelTag} ${ctxStr}${msg}${payloadStr}\n`;

    const sink = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    sink.write(line);
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

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
}
