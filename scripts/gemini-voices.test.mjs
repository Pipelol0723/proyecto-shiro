// @ts-check
// Tests del script de voces de Gemini. Se ejecutan con `npm run test:scripts`
// (node --test). Ningún test llama a Google: `fetch` se simula.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RECIPE, buildCreateBody, daysLeft, main, parseVoice } from './gemini-voices.mjs';

/** @param {string} name */
const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = 'scripts/gemini-voices.mjs';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = 'clave-secreta-de-prueba-123';
const AUDIO = 'QUJDREVGR0hJSktMTU5PUA';
const NOW = Date.parse('2026-11-14T00:00:00Z');
const DAY_MS = 86_400_000;

/** Respuesta simulada de fetch. */
const reply = (/** @type {unknown} */ body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Voz de prueba que caduca dentro de `days` días (más una hora, lejos del borde). */
const voiceIn = (/** @type {number} */ days) => ({
  ...fixture('gemini-voices-get.json'),
  expire_time: new Date(NOW + days * DAY_MS + 3_600_000).toISOString().replace('Z', '000000Z'),
});

/**
 * Ejecuta `main` con todo inyectado.
 * @param {string[]} argv
 * @param {Array<unknown> | ((url: string, init: any) => unknown)} responses
 * @param {Record<string, string | undefined>} env
 */
async function run(argv, responses = [], env = { GEMINI_API_KEY: KEY }) {
  /** @type {Array<{ url: string, init: any }>} */
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  let out = '';
  let err = '';
  const code = await main(argv, {
    fetch: async (/** @type {string} */ url, /** @type {any} */ init) => {
      calls.push({ url, init });
      if (typeof responses === 'function') return responses(url, init);
      const next = queue?.shift();
      if (next === undefined) throw new Error('fetch inesperado');
      return next;
    },
    env,
    now: () => NOW,
    stdout: (/** @type {string} */ s) => (out += `${s}\n`),
    stderr: (/** @type {string} */ s) => (err += `${s}\n`),
  });
  return { code, calls, out, err };
}

test('buildCreateBody usa la receta del ADR', () => {
  const body = buildCreateBody({ displayName: 'shiro-precisa' });
  assert.deepEqual(body, {
    store: true,
    voice: {
      model: 'gemini-3.8-flash-tts',
      type: 'prompted',
      display_name: 'shiro-precisa',
      gender: 'female',
      language_code: 'es-MX',
      prompted: { input: RECIPE.description },
    },
  });
  assert.match(RECIPE.description, /^A cool, analytical young woman about 20/);
  assert.match(RECIPE.description, /flat-to-falling intonation\.$/);
});

test('create sin --yes sale con 2 y no llama a fetch', async () => {
  const r = await run(['create']);
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /^gemini-voices: .*--yes/m);
});

test('create --dry-run no llama a fetch y no imprime la clave', async () => {
  const r = await run(['create', '--dry-run']);
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 0);
  assert.ok(r.out.includes('"gemini-3.8-flash-tts"'));
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY));
});

test('create --dry-run funciona sin clave', async () => {
  const r = await run(['create', '--dry-run'], [], {});
  assert.equal(r.code, 0);
});

test('create envía POST /voices con x-goog-api-key', async () => {
  const r = await run(['create', '--yes'], [reply(fixture('gemini-voices-get.json'))]);
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, `${BASE}/voices`);
  assert.equal(r.calls[0].init.method, 'POST');
  assert.equal(r.calls[0].init.headers['x-goog-api-key'], KEY);
  assert.deepEqual(JSON.parse(r.calls[0].init.body), buildCreateBody({}));
  assert.match(r.out, /voice_test00000001/);
  assert.ok(!r.out.includes(AUDIO), 'no imprime sample_audio');
});

test('create reintenta con el siguiente idioma solo ante 400', async () => {
  const bad = fixture('gemini-voices-bad-language.json');
  const r = await run(
    ['create', '--yes'],
    [reply(bad, 400), reply(fixture('gemini-voices-get.json'))],
  );
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 2);
  assert.equal(JSON.parse(r.calls[0].init.body).voice.language_code, 'es-MX');
  assert.equal(JSON.parse(r.calls[1].init.body).voice.language_code, 'es-US');

  const other = await run(['create', '--yes'], [reply({ error: { message: 'cuota' } }, 429)]);
  assert.equal(other.code, 2);
  assert.equal(other.calls.length, 1, 'un 429 no reintenta con otro idioma');
});

test('create no reintenta idiomas ante un 400 que no habla del idioma', async () => {
  const badKey = { error: { message: 'API key not valid.', status: 'INVALID_ARGUMENT' } };
  const r = await run(['create', '--yes'], () => reply(badKey, 400));
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 1);
  assert.match(r.err, /comprueba con `list`/);
});

test('create sale con 2 si la respuesta no trae id', async () => {
  const r = await run(['create', '--yes'], [reply({})]);
  assert.equal(r.code, 2);
});

test('las peticiones llevan un tope de tiempo', async () => {
  const r = await run(['get', 'voice_test00000001'], [reply(voiceIn(40))]);
  assert.ok(r.calls[0].init.signal instanceof AbortSignal);
});

test('la clave se recorta antes de usarla', async () => {
  const r = await run(['get', 'voice_test00000001'], [reply(voiceIn(40))], {
    GEMINI_API_KEY: `${KEY}\n`,
  });
  assert.equal(r.calls[0].init.headers['x-goog-api-key'], KEY);
});

test('las opciones y palabras que no corresponden al subcomando salen con 2', async () => {
  for (const argv of [
    ['list', '--dry-run'],
    ['get', 'voice_test00000001', '--dry-run'],
    ['get', 'voice_test00000001', '--yes'],
    ['get', 'voice_test00000001', '--all'],
    ['create', '--all'],
    ['list', '--name', 'x'],
    ['create', 'foo', '--yes'],
    ['list', 'x'],
  ]) {
    const r = await run(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.calls.length, 0, argv.join(' '));
  }
});

test('get de una voz de catálogo sin expire_time sale con 0', async () => {
  const prebuilt = { ...voiceIn(40), type: 'prebuilt', expire_time: undefined };
  const r = await run(['get', 'voice_test00000001'], [reply(prebuilt)]);
  assert.equal(r.code, 0);
  assert.match(r.out, /sin caducidad/);
});

test('list avisa si no hay voces propias, si el token se repite y si llega al tope', async () => {
  const none = await run(['list'], [reply({ voices: [] })]);
  assert.equal(none.code, 0);
  assert.match(none.err, /sin voces propias/);

  const same = { voices: [], next_page_token: 'igual' };
  const repeated = await run(['list', '--all'], () => reply(same));
  assert.equal(repeated.calls.length, 2, 'corta si el token no cambia');

  let n = 0;
  const capped = await run(['list', '--all'], () =>
    reply({ voices: [], next_page_token: `t${n++}` }),
  );
  assert.match(capped.err, /tope/);
});

test('get devuelve 0 con 31 días o más', async () => {
  const r = await run(['get', 'voice_test00000001'], [reply(voiceIn(31))]);
  assert.equal(r.code, 0);
  assert.equal(r.calls[0].url, `${BASE}/voices/voice_test00000001`);
  assert.equal(r.calls[0].init.method ?? 'GET', 'GET');
  assert.match(r.out, /31/);
  assert.ok(!r.out.includes(AUDIO), 'no imprime sample_audio');
});

test('get devuelve 1 con 29 días', async () => {
  const r = await run(['get', 'voice_test00000001'], [reply(voiceIn(29))]);
  assert.equal(r.code, 1);
  assert.match(r.out + r.err, /29/);
});

test('get devuelve 1 con 404', async () => {
  const r = await run(['get', 'voice_nada'], [reply(fixture('gemini-voices-not-found.json'), 404)]);
  assert.equal(r.code, 1);
  assert.match(r.err, /^gemini-voices: /m);
});

test('get devuelve 1 con voz caducada', async () => {
  const r = await run(['get', 'voice_test00000001'], [reply(voiceIn(-3))]);
  assert.equal(r.code, 1);
  assert.match(r.out + r.err, /caducad/);
});

test('get devuelve 2 con expire_time ilegible', async () => {
  const unreadable = { ...voiceIn(40), expire_time: 'mañana por la tarde' };
  assert.equal((await run(['get', 'voice_test00000001'], [reply(unreadable)])).code, 2);
  const missing = { ...voiceIn(40), expire_time: undefined };
  assert.equal((await run(['get', 'voice_test00000001'], [reply(missing)])).code, 2);
});

test('get sin id sale con 2', async () => {
  assert.equal((await run(['get'])).code, 2);
});

test('list imprime solo las voces propias y se detiene al llegar al catálogo', async () => {
  const r = await run(['list'], [reply(fixture('gemini-voices-list-page1.json'))]);
  assert.equal(r.code, 0);
  assert.match(r.out, /voice_test00000001/);
  assert.ok(!r.out.includes('ar-eg-assistant-5'));
  assert.equal(r.calls.length, 1, 'no sigue paginando tras ver una voz de catálogo');
});

test('list sigue next_page_token mientras haya voces propias', async () => {
  const page1 = { ...fixture('gemini-voices-list-own-only.json'), next_page_token: 'sig' };
  const r = await run(['list'], [reply(page1), reply(fixture('gemini-voices-list-page1.json'))]);
  assert.equal(r.calls.length, 2);
  assert.match(r.calls[1].url, /pageToken=sig/);
  assert.match(r.out, /voice_test00000002/);
});

test('list sin next_page_token pide una sola página', async () => {
  const r = await run(['list'], [reply(fixture('gemini-voices-list-own-only.json'))]);
  assert.equal(r.calls.length, 1);
  assert.match(r.out, /voice_test00000002/);
});

test('list --all muestra también el catálogo y respeta el tope de páginas', async () => {
  const r = await run(
    ['list', '--all'],
    [
      reply(fixture('gemini-voices-list-page1.json')),
      reply(fixture('gemini-voices-list-page2.json')),
    ],
  );
  assert.match(r.out, /ar-eg-assistant-5/);
  assert.match(r.out, /es-mx-assistant-2/);
  assert.equal(r.calls.length, 2);

  const endless = { voices: [], next_page_token: 'otra' };
  const capped = await run(['list', '--all'], () => reply(endless));
  assert.equal(capped.code, 0);
  assert.ok(capped.calls.length <= 20, 'tope de páginas');
});

test('sin GEMINI_API_KEY sale con 2', async () => {
  const r = await run(['get', 'voice_test00000001'], [], {});
  assert.equal(r.code, 2);
  assert.equal(r.calls.length, 0);
  assert.match(r.err, /GEMINI_API_KEY/);
});

test('opción o subcomando desconocido sale con 2', async () => {
  assert.equal((await run(['list', '--nada'])).code, 2);
  assert.equal((await run(['delete', 'voice_test00000001'])).code, 2);
  assert.equal((await run([])).code, 2);
});

test('la clave nunca aparece en stdout ni stderr', async () => {
  const leaky = reply({ error: { message: `mala clave ${KEY}` } }, 403);
  const runs = [
    await run(['get', 'voice_test00000001'], [leaky]),
    await run(['create', '--yes'], [leaky]),
    await run(['list'], [leaky]),
    await run(['get', 'x'], () => {
      throw new Error(`fallo de red con ${KEY}`);
    }),
  ];
  for (const r of runs) {
    assert.equal(r.code, 2);
    assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY));
  }
});

test('parseVoice descarta sample_audio y daysLeft entiende nueve decimales', () => {
  const voice = parseVoice(fixture('gemini-voices-get.json'));
  assert.equal(voice.id, 'voice_test00000001');
  assert.equal(voice.expireTime, '2027-11-13T06:31:43.942416695Z');
  assert.ok(!('sample_audio' in voice) && !('sampleAudio' in voice));
  assert.equal(daysLeft('2026-12-14T00:00:00.000000000Z', NOW), 30);
  assert.equal(daysLeft('2026-12-13T23:00:00.123456789Z', NOW), 29);
  assert.equal(daysLeft('no es una fecha', NOW), null);
  assert.equal(daysLeft(undefined, NOW), null);
  assert.ok(/** @type {number} */ (daysLeft('2026-11-10T00:00:00Z', NOW)) < 0);
});

test('importar el módulo no ejecuta la CLI', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('./scripts/gemini-voices.mjs')"],
    { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '' } },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('CLI real: create --dry-run imprime el cuerpo y sale con 0 sin red ni clave', () => {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  const result = spawnSync(process.execPath, [SCRIPT, 'create', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /gemini-3\.8-flash-tts/);
});

test('CLI real: create sin --yes y opción desconocida salen con 2', () => {
  const env = { ...process.env, GEMINI_API_KEY: KEY };
  const spawn = (/** @type {string[]} */ ...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8', env });
  const a = spawn('create');
  assert.equal(a.status, 2);
  assert.equal(spawn('list', '--nada').status, 2);
  assert.ok(!a.stdout.includes(KEY) && !a.stderr.includes(KEY));
});
