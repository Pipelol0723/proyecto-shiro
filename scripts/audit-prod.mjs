// @ts-check
/**
 * audit-prod.mjs — audit de producción para el CI (ítem P-04, fila SEC-12).
 *
 * Ejecuta `npm audit --omit=dev --json` y falla si hay un aviso high o
 * critical que no tape una excepción vigente de `audit-exceptions.json`.
 * Una excepción caducada falla siempre, exista o no el aviso: obliga a
 * retirarla o a renovarla a propósito.
 *
 * Códigos de salida: 0 limpio · 1 avisos o excepción caducada · 2 no se pudo
 * evaluar (sin red, salida que no es JSON, excepciones mal escritas).
 *
 * Uso: node scripts/audit-prod.mjs [--input informe.json] [--exceptions archivo.json]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_EXCEPTIONS = fileURLToPath(new URL('./audit-exceptions.json', import.meta.url));

/**
 * @typedef {{ package: string, advisory?: string, reason: string, expires: string, item: string }} AuditException
 * @typedef {{ package: string, severity: string, advisories: string[], fixAvailable: boolean }} AuditFailure
 * @typedef {{ severity: string, via: Array<string | { url?: string, source?: number, severity?: string }>, fixAvailable?: unknown }} AuditEntry
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
  const all = readExceptions(exceptions);
  // Una excepción vale hasta el día de su fecha, incluido.
  const expired = all.filter((e) => e.expires < today);
  const active = all.filter((e) => e.expires >= today);

  /** @type {AuditFailure[]} */
  const failures = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!BLOCKING_SEVERITIES.has(entry.severity)) continue;
    const via = Array.isArray(entry.via) ? entry.via : [];
    const direct = via.flatMap((v) => (typeof v === 'string' ? [] : [v]));
    const blocking = direct
      .filter((v) => BLOCKING_SEVERITIES.has(String(v.severity)))
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
      severity: entry.severity,
      advisories: direct.map(advisoryId),
      fixAvailable: entry.fixAvailable !== false,
    });
  }
  return { ok: failures.length === 0 && expired.length === 0, failures, expired };
}

/** @param {{ url?: string, source?: number }} advisory */
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
 * @returns {AuditException[]}
 */
function readExceptions(exceptions) {
  if (!Array.isArray(exceptions)) throw new Error('las excepciones deben ser una lista');
  for (const e of exceptions) {
    const valid =
      e &&
      typeof e.package === 'string' &&
      typeof e.reason === 'string' &&
      e.reason.trim() !== '' &&
      typeof e.item === 'string' &&
      typeof e.expires === 'string' &&
      DATE_PATTERN.test(e.expires) &&
      (e.advisory === undefined || typeof e.advisory === 'string');
    if (!valid) {
      throw new Error(
        `excepción mal escrita (package, reason, item y expires AAAA-MM-DD son obligatorios): ${JSON.stringify(e)}`,
      );
    }
  }
  return exceptions;
}

/** @param {string[]} argv */
function main(argv) {
  /** @param {string} flag */
  const option = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  try {
    const input = option('--input');
    // Línea de comando fija y con shell: en Windows `npm` es `npm.cmd`.
    // npm sale con código distinto de 0 cuando hay avisos; se lee stdout igual.
    const raw = input
      ? readFileSync(input, 'utf8')
      : spawnSync('npm audit --omit=dev --json', {
          shell: true,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }).stdout;
    const exceptions = JSON.parse(
      readFileSync(option('--exceptions') ?? DEFAULT_EXCEPTIONS, 'utf8'),
    );
    const today = new Date().toISOString().slice(0, 10);
    const result = evaluateAudit(JSON.parse(raw ?? ''), exceptions, today);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
