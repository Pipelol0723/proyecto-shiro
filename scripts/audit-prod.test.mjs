// @ts-check
// Tests del audit de producción. Se ejecutan con `npm run test:scripts`
// (node --test), no con Vitest: el script es una herramienta de Node suelta.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateAudit } from './audit-prod.mjs';

/** @param {string} name */
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SCRIPT = fileURLToPath(new URL('./audit-prod.mjs', import.meta.url));
const TODAY = '2026-11-13';
const ZOD_ADVISORY = 'GHSA-mrhx-c7xc-m3w5';

/** Informe real de antes de P-04 (zod y form-data high, qs moderate), filtrado por paquete. */
const report = (/** @type {string[]} */ ...names) => {
  const full = JSON.parse(readFileSync(fixture('audit-antes-p04.json'), 'utf8'));
  const kept = Object.entries(full.vulnerabilities).filter(([name]) => names.includes(name));
  return { ...full, vulnerabilities: Object.fromEntries(kept) };
};
const exception = (over = {}) => ({
  package: 'zod',
  reason: 'prueba',
  expires: '2026-12-31',
  item: 'P-99',
  ...over,
});
/** @param {string[]} args */
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('pasa con un informe sin vulnerabilidades', () => {
  assert.deepEqual(evaluateAudit(report(), [], TODAY), { ok: true, failures: [], expired: [] });
});

test('falla con una vulnerabilidad high de producción sin excepción', () => {
  const result = evaluateAudit(report('zod'), [], TODAY);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    { package: 'zod', severity: 'high', advisories: [ZOD_ADVISORY], fixAvailable: true },
  ]);
});

test('falla con una critical', () => {
  const critical = report('zod');
  critical.vulnerabilities.zod.severity = 'critical';
  critical.vulnerabilities.zod.via[0].severity = 'critical';
  assert.equal(evaluateAudit(critical, [], TODAY).failures[0].severity, 'critical');
});

test('ignora moderate y low', () => {
  assert.equal(evaluateAudit(report('qs'), [], TODAY).ok, true);
  const low = report('qs');
  low.vulnerabilities.qs.severity = 'low';
  assert.equal(evaluateAudit(low, [], TODAY).ok, true);
});

test('una excepción vigente tapa su paquete y solo el suyo', () => {
  assert.equal(evaluateAudit(report('zod'), [exception()], TODAY).ok, true);
  const result = evaluateAudit(report('zod', 'form-data'), [exception()], TODAY);
  assert.deepEqual(
    result.failures.map((f) => f.package),
    ['form-data'],
  );
});

test('una excepción vale hasta el día de su fecha, incluido', () => {
  assert.equal(evaluateAudit(report('zod'), [exception({ expires: TODAY })], TODAY).ok, true);
});

test('una excepción caducada falla aunque el aviso siga', () => {
  const result = evaluateAudit(report('zod'), [exception({ expires: '2026-11-12' })], TODAY);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1, 'caducada: ya no tapa el aviso');
  assert.equal(result.expired.length, 1);
});

test('una excepción caducada falla aunque el aviso ya no exista', () => {
  const result = evaluateAudit(report(), [exception({ expires: '2026-11-12' })], TODAY);
  assert.deepEqual([result.ok, result.failures.length, result.expired.length], [false, 0, 1]);
});

test('una excepción con advisory solo tapa ese aviso', () => {
  const sameAdvisory = [exception({ advisory: ZOD_ADVISORY })];
  const otherAdvisory = [exception({ advisory: 'GHSA-otro-aviso' })];
  assert.equal(evaluateAudit(report('zod'), sameAdvisory, TODAY).ok, true);
  assert.equal(evaluateAudit(report('zod'), otherAdvisory, TODAY).ok, false);
});

test('rechaza un informe sin vulnerabilities y una excepción mal escrita', () => {
  assert.throws(
    () => evaluateAudit({ error: { code: 'ENOTFOUND' } }, [], TODAY),
    /vulnerabilities/,
  );
  assert.throws(() => evaluateAudit(report(), [{ package: 'zod' }], TODAY), /mal escrita/);
  assert.throws(
    () => evaluateAudit(report(), [exception({ expires: 'pronto' })], TODAY),
    /mal escrita/,
  );
});

test('la CLI devuelve código 2 si la salida no es JSON', () => {
  const result = cli('--input', fixture('audit-no-json.txt'));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no se pudo evaluar/);
});

test('la CLI devuelve código 1 y nombra el paquete cuando hay un aviso high', () => {
  const result = cli('--input', fixture('audit-antes-p04.json'));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /high\s+zod\s+GHSA-mrhx-c7xc-m3w5/);
});
