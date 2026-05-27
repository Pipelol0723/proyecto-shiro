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

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
}
