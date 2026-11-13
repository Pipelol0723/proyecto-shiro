// @ts-check
/**
 * audit-prod.mjs — audit de producción para el CI (ítem P-04, fila SEC-12).
 *
 * Ejecuta `npm audit --omit=dev --json` y falla si hay un aviso high o
 * critical que no tape una excepción vigente de `audit-exceptions.json`.
 * Una excepción caducada falla siempre, exista o no el aviso: obliga a
 * retirarla o a renovarla a propósito.
 *
 * Excepciones: `{ package, advisory?, reason, expires, item }`. Sin `advisory`
 * tapa el paquete entero, también los avisos que aparezcan después, hasta que
 * caduque: mejor ponerlo siempre. Un aviso heredado (el paquete solo es
 * vulnerable por otro) hay que taparlo en cada paquete de la cadena, sin
 * `advisory`. `expires` no puede pasar de MAX_EXCEPTION_DAYS días desde hoy.
 *
 * Códigos de salida: 0 limpio · 1 avisos o excepción caducada · 2 no se pudo
 * evaluar (sin red, salida que no es JSON, excepciones u opciones mal escritas).
 *
 * Uso: node scripts/audit-prod.mjs [--input informe.json] [--exceptions archivo.json]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const EXCEPTION_KEYS = new Set(['package', 'advisory', 'reason', 'expires', 'item']);
const CLI_OPTIONS = new Set(['--input', '--exceptions']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EXCEPTION_DAYS = 180;
const DAY_MS = 86_400_000;
const DEFAULT_EXCEPTIONS = fileURLToPath(new URL('./audit-exceptions.json', import.meta.url));

/**
 * @typedef {{ package: string, advisory?: string, reason: string, expires: string, item: string }} AuditException
 * @typedef {{ package: string, severity: string, advisories: string[], fixAvailable: boolean }} AuditFailure
 * @typedef {{ url?: string, source?: number, severity?: unknown }} AuditAdvisory
 * @typedef {{ severity?: unknown, via?: Array<string | AuditAdvisory>, fixAvailable?: unknown }} AuditEntry
 */

/**
 * Decide si un informe de `npm audit --json` pasa.
 *
 * @param {unknown} report informe ya parseado
 * @param {unknown} exceptions contenido de `audit-exceptions.json`
 * @param {string} today fecha de hoy (AAAA-MM-DD); se inyecta para poder probarlo
 * @returns {{ ok: boolean, failures: AuditFailure[], expired: AuditException[] }}
 */
export function evaluateAudit(report, exceptions, today) {
  const vulnerabilities = readVulnerabilities(report);
  const all = readExceptions(exceptions, today);
  // Una excepción vale hasta el día de su fecha, incluido.
  const expired = all.filter((e) => e.expires < today);
  const active = all.filter((e) => e.expires >= today);

  /** @type {AuditFailure[]} */
  const failures = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(entry.via) ? entry.via : [];
    const direct = via.flatMap((v) => (typeof v === 'string' ? [] : [v]));
    // Manda la severidad más alta entre la entrada y sus avisos, por si no cuadran.
    const severities = [entry.severity, ...direct.map((v) => v.severity)].map(normalizeSeverity);
    const severity = ['critical', 'high'].find((level) => severities.includes(level));
    if (!severity) continue;

    const blocking = direct
      .filter((v) => BLOCKING_SEVERITIES.has(normalizeSeverity(v.severity)))
      .map(advisoryId);
    const forPackage = active.filter((e) => e.package === name);
    // Tapa el paquete entero una excepción sin `advisory`. Con `advisory`
    // solo tapa si cubre todos los avisos bloqueantes y ninguno llega
    // heredado de otro paquete (esos solo se tapan por paquete).
    const covered =
      forPackage.some((e) => e.advisory === undefined) ||
      (direct.length === via.length &&
        blocking.length > 0 &&
        blocking.every((id) => forPackage.some((e) => e.advisory === id)));
    if (covered) continue;
    failures.push({
      package: name,
      severity,
      advisories: direct.map(advisoryId),
      fixAvailable: entry.fixAvailable !== false,
    });
  }
  return { ok: failures.length === 0 && expired.length === 0, failures, expired };
}

/** @param {unknown} severity */
function normalizeSeverity(severity) {
  return typeof severity === 'string' ? severity.toLowerCase() : '';
}

/** @param {AuditAdvisory} advisory */
function advisoryId(advisory) {
  return advisory.url?.split('/').pop() || String(advisory.source ?? 'sin-id');
}

/**
 * @param {unknown} report
 * @returns {Record<string, AuditEntry>}
 */
function readVulnerabilities(report) {
  const found = /** @type {{ vulnerabilities?: unknown } | null} */ (report)?.vulnerabilities;
  // Un error de npm (p. ej. sin red) llega como `{ "error": … }`: no es «0 avisos».
  if (!found || typeof found !== 'object') {
    throw new Error('el informe no trae «vulnerabilities» (¿error de npm o sin red?)');
  }
  return /** @type {Record<string, AuditEntry>} */ (found);
}

/**
 * @param {unknown} exceptions
 * @param {string} today
 * @returns {AuditException[]}
 */
function readExceptions(exceptions, today) {
  if (!Array.isArray(exceptions)) throw new Error('las excepciones deben ser una lista');
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_EXCEPTION_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  for (const e of exceptions) {
    const problem = exceptionProblem(e, limit);
    if (problem) throw new Error(`excepción mal escrita (${problem}): ${JSON.stringify(e)}`);
  }
  return exceptions;
}

/**
 * @param {unknown} exception
 * @param {string} limit última fecha de caducidad admitida
 * @returns {string | undefined} el problema, o `undefined` si está bien escrita
 */
function exceptionProblem(exception, limit) {
  if (!exception || typeof exception !== 'object') return 'no es un objeto';
  const e = /** @type {Record<string, unknown>} */ (exception);
  // Una clave con errata (p. ej. `advisorie`) convertiría la excepción en una
  // de paquete entero sin que nadie lo viera.
  const unknown = Object.keys(e).filter((key) => !EXCEPTION_KEYS.has(key));
  if (unknown.length > 0) return `clave desconocida: ${unknown.join(', ')}`;
  const required = ['package', 'reason', 'item', 'expires'];
  const optional = e.advisory === undefined ? [] : ['advisory'];
  for (const key of [...required, ...optional]) {
    const value = e[key];
    if (typeof value !== 'string' || value.trim() === '') return `falta ${key}`;
  }
  const expires = String(e.expires);
  const time = DATE_PATTERN.test(expires) ? Date.parse(`${expires}T00:00:00Z`) : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== expires) {
    return 'expires debe ser una fecha AAAA-MM-DD que exista';
  }
  if (expires > limit) return `expires pasa de ${MAX_EXCEPTION_DAYS} días`;
  return undefined;
}

/**
 * @param {string[]} argv
 * @param {string} flag
 */
function option(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} necesita un valor`);
  return value;
}

/** Lanza el audit real. npm sale con código distinto de 0 si hay avisos: se lee stdout igual. */
function runNpmAudit() {
  // Línea de comando fija y con shell: en Windows `npm` es `npm.cmd`.
  const result = spawnSync('npm audit --omit=dev --json', {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`no se pudo lanzar npm audit: ${result.error.message}`);
  return { raw: result.stdout, hint: result.stderr.trim().slice(0, 300) };
}

/** @param {string[]} argv */
function main(argv) {
  try {
    const stray = argv.filter((arg) => arg.startsWith('--') && !CLI_OPTIONS.has(arg));
    if (stray.length > 0) throw new Error(`opción desconocida: ${stray.join(', ')}`);
    const input = option(argv, '--input');
    const exceptionsFile = option(argv, '--exceptions') ?? DEFAULT_EXCEPTIONS;
    const { raw, hint } = input ? { raw: readFileSync(input, 'utf8'), hint: '' } : runNpmAudit();
    let report;
    try {
      report = JSON.parse(raw);
    } catch {
      throw new Error(`la salida de npm audit no es JSON${hint ? ` (${hint})` : ''}`);
    }
    const exceptions = JSON.parse(readFileSync(exceptionsFile, 'utf8'));
    const result = evaluateAudit(report, exceptions, new Date().toISOString().slice(0, 10));
    for (const f of result.failures) {
      const fix = f.fixAvailable ? 'hay arreglo' : 'sin arreglo';
      console.log(
        `${f.severity.padEnd(9)} ${f.package.padEnd(28)} ${f.advisories.join(', ')} (${fix})`,
      );
    }
    for (const e of result.expired) {
      console.log(
        `caducada  ${e.package.padEnd(28)} excepción vencida el ${e.expires} (${e.item})`,
      );
    }
    console.log(
      result.ok
        ? 'audit-prod: sin avisos high ni critical en producción.'
        : `audit-prod: ${result.failures.length} aviso(s) sin tapar y ${result.expired.length} excepción(es) caducada(s).`,
    );
    return result.ok ? 0 : 1;
  } catch (err) {
    console.error(`audit-prod: no se pudo evaluar el audit: ${/** @type {Error} */ (err).message}`);
    return 2;
  }
}

/**
 * ¿Se ejecutó este archivo como programa? Con `realpath` en los dos lados:
 * Node resuelve los enlaces en `import.meta.url` pero no en `argv[1]`, y una
 * comparación fallida saldría con 0 sin haber evaluado nada.
 */
function isMainModule() {
  try {
    const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
    return invoked === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = main(process.argv.slice(2));
}
