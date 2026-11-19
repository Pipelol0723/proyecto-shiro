/**
 * Comprueba behavior-cases.json contra el reproductor del prototipo
 * (../player/shiro-chibi.js), sin navegador: el canvas se sustituye por un
 * doble que apunta que imagen se pinta, donde y con que opacidad.
 *
 * Uso: node check-cases.mjs
 * Sale con codigo 1 si algun caso no coincide.
 */
import { readFile } from 'node:fs/promises';

const here = new URL('.', import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, here), 'utf8'));

// ---- dobles del canvas -----------------------------------------------------
class FakeContext {
  constructor(log) {
    this.log = log;
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.stack = [];
  }
  save() {
    this.stack.push([this.globalAlpha, this.globalCompositeOperation]);
  }
  restore() {
    [this.globalAlpha, this.globalCompositeOperation] = this.stack.pop();
  }
  translate() {}
  scale() {}
  clearRect() {}
  drawImage(image, x, y) {
    this.log.push({
      image: image.name,
      at: [x, y],
      alpha: this.globalAlpha,
      op: this.globalCompositeOperation,
    });
  }
}

let eyesLog = [];
globalThis.document = {
  createElement: () => ({
    name: '<eyes>',
    width: 0,
    height: 0,
    getContext: () => new FakeContext(eyesLog),
  }),
};

const { LayeredAvatar, computeMouthOpen, FADE_MS } = await import('../player/shiro-chibi.js');

// ---- utilidades --------------------------------------------------------------
const cases = await readJson('behavior-cases.json');
const TOL = cases.tolerance;
const num = (v) => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v);
const close = (a, b) => Math.abs(a - b) <= TOL;
const closeAll = (a, b) => a.length === b.length && a.every((v, i) => close(v, b[i]));

let failed = 0;
let total = 0;
function check(group, label, ok, detail) {
  total += 1;
  if (ok) return;
  failed += 1;
  console.error(`FALLA [${group}] ${label}: ${detail}`);
}

function makeAvatar(manifest) {
  const images = {};
  for (const name of [...Object.keys(manifest.layers), ...Object.keys(manifest.face.pieces)]) {
    images[name] = { name };
  }
  eyesLog = [];
  const avatar = new LayeredAvatar(manifest, images);
  avatar.eyeCtx.log = eyesLog;
  avatar.setBlink(0); // sin parpadeo automatico salvo que el caso lo pida
  return avatar;
}

/** Entra en una expresion y deja pasar tiempo de sobra para que todo se asiente. */
function settle(avatar, expression) {
  avatar.setExpression(expression);
  for (let i = 0; i < 200; i += 1) avatar.update(16);
}

function paint(avatar) {
  const log = [];
  eyesLog.length = 0;
  avatar.time = 0; // sin respiracion: no afecta a lo que se apunta, pero queda fijo
  avatar.draw(new FakeContext(log), 0, 0, avatar.width, avatar.height);
  return { main: log, eyes: [...eyesLog] };
}

function sameDraws(got, want, withOp) {
  if (got.length !== want.length) return false;
  return want.every((w, i) => {
    const g = got[i];
    if (g.image !== w.image || !closeAll(g.at, w.at)) return false;
    if (w.alpha !== undefined && !close(g.alpha, w.alpha)) return false;
    if ((withOp || w.op) && w.op && g.op !== w.op) return false;
    return true;
  });
}
const show = (draws) => draws.map((d) => `${d.image}@${d.at}×${d.alpha}/${d.op}`).join(', ');

const manifest = await readJson(cases.manifest);

// ---- boca ----------------------------------------------------------------------
for (const c of cases.mouth) {
  const a = makeAvatar(manifest);
  a.setMouthOpen(num(c.mouthOpen));
  const got = a.mouthFor(c.expression);
  check('boca', `${c.expression} ${c.mouthOpen}`, got === c.piece, `${got} ≠ ${c.piece}`);
}

// ---- ojos con parpadeo manual --------------------------------------------------
for (const c of cases.eyes) {
  const a = makeAvatar(manifest);
  a.setBlink(c.blink);
  const got = a.eyesFor(c.expression);
  check('ojos', `${c.expression} ${c.blink}`, got === c.state, `${got} ≠ ${c.state}`);
}

// ---- parpadeo automatico --------------------------------------------------------
{
  const { expression, samples, nextIntervalMs } = cases.autoBlink;
  const duration = manifest.face.blink.duration_ms;
  for (const s of samples) {
    const a = makeAvatar(manifest);
    a.setBlink(null);
    a.nextBlink = 1000;
    a.blinkClock = 1000 + s.t * duration;
    a.update(0);
    check('parpadeo', `t=${s.t} valor`, close(a.blink, s.blink), `${a.blink} ≠ ${s.blink}`);
    const got = a.eyesFor(expression);
    check('parpadeo', `t=${s.t} estado`, got === s.state, `${got} ≠ ${s.state}`);
    if (s.t >= 1) {
      const ok =
        a.blinkClock === 0 && a.nextBlink >= nextIntervalMs[0] && a.nextBlink <= nextIntervalMs[1];
      check(
        'parpadeo',
        'siguiente intervalo',
        ok,
        `reloj ${a.blinkClock}, siguiente ${a.nextBlink}`,
      );
    }
  }
}

// ---- mirada ------------------------------------------------------------------------
for (const c of cases.gaze) {
  const a = makeAvatar(manifest);
  a.setExpression(c.expression);
  for (const call of c.calls) {
    a.setLookAt(...call.map(num));
    for (let i = 0; i < 200; i += 1) a.update(16);
  }
  for (let i = 0; i < 200; i += 1) a.update(16);
  const label = `${c.expression} ${JSON.stringify(c.calls)}`;
  check('mirada', `${label} look`, closeAll(a.look, c.look), `${a.look} ≠ ${c.look}`);
  const offset = a.irisOffset();
  check('mirada', `${label} iris`, closeAll(offset, c.irisOffset), `${offset} ≠ ${c.irisOffset}`);
}

for (const c of cases.gazeSmoothing.cases) {
  const a = makeAvatar(manifest);
  a.setLookAt(1, 0);
  for (const dt of c.steps) a.update(num(dt));
  check('suavizado', `pasos ${c.steps}`, close(a.look[0], c.lookX), `${a.look[0]} ≠ ${c.lookX}`);
}

// ---- expresiones ----------------------------------------------------------------------
{
  const e = cases.expression;
  check('expresión', 'FADE_MS', FADE_MS === e.fadeMs, `${FADE_MS} ≠ ${e.fadeMs}`);

  for (const name of e.unknown) {
    const a = makeAvatar(manifest);
    a.setExpression('smirk');
    a.setExpression(name);
    check(
      'expresión',
      `desconocida "${name}"`,
      a.expression === e.unknownFallsBackTo,
      `${a.expression} ≠ ${e.unknownFallsBackTo}`,
    );
  }

  for (const c of e.fade) {
    const b = makeAvatar(manifest);
    settle(b, c.from);
    b.setExpression(c.to);
    if (c.afterMs > 0) b.update(c.afterMs);
    const ok = close(b.fade, c.fade) && b.previous === c.previous;
    check(
      'expresión',
      `fundido a los ${c.afterMs} ms`,
      ok,
      `fade ${b.fade}, previous ${b.previous}`,
    );
  }

  const same = makeAvatar(manifest);
  same.setExpression('smirk');
  same.update(70);
  same.setExpression('smirk');
  check('expresión', 'repetir no reinicia el fundido', close(same.fade, 0.5), `fade ${same.fade}`);

  for (const c of e.emotions) {
    const b = makeAvatar(manifest);
    b.setExpression('smirk'); // para que "idle" sea un cambio observable
    if (c.expression === 'smirk') b.setExpression('idle');
    b.setEmotion(c.emotion);
    check(
      'expresión',
      `emoción ${c.emotion}`,
      b.expression === c.expression,
      `${b.expression} ≠ ${c.expression}`,
    );
  }
}

// ---- brillo --------------------------------------------------------------------------------
for (const c of cases.glow) {
  const a = makeAvatar(manifest);
  a.setExpression(c.expression);
  a.time = c.timeMs;
  a.sinceEnter = c.sinceEnterMs;
  if (c.setGlow !== undefined) a.setGlow(num(c.setGlow));
  const got = a.glowLevel();
  const label = `${c.expression} t=${c.timeMs} ${c.setGlow ?? ''}`;
  check('brillo', label, close(got, c.level), `${got} ≠ ${c.level}`);
}

// ---- que se pinta y en que orden -------------------------------------------------------------
for (const c of cases.draw.cases) {
  const a = makeAvatar(manifest);
  if (c.from) {
    settle(a, c.from);
    a.setExpression(c.expression);
    a.update(c.fadeMs);
  } else {
    settle(a, c.expression);
    a.sinceEnter = 1e9; // destello ya apagado
  }
  a.setBlink(c.blink);
  a.setMouthOpen(c.mouthOpen);
  a.setOutline(c.outline);
  if (c.setGlow !== undefined) a.setGlow(c.setGlow);
  const got = paint(a);
  check('dibujo', `${c.name} (principal)`, sameDraws(got.main, c.main), show(got.main));
  if (c.eyes)
    check('dibujo', `${c.name} (ojos)`, sameDraws(got.eyes, c.eyes, true), show(got.eyes));
}

// ---- nivel de voz -> apertura --------------------------------------------------------------------
for (const c of cases.computeMouthOpen) {
  const got = c.gain === undefined ? computeMouthOpen(c.freq) : computeMouthOpen(c.freq, c.gain);
  check('voz', JSON.stringify(c.freq), close(got, c.open), `${got} ≠ ${c.open}`);
}

// ---- manifiesto minimo: valores por defecto ---------------------------------------------------------
{
  const { manifest: file, expect } = cases.minimalManifest;
  const a = makeAvatar(await readJson(file));
  check('mínimo', 'brillo', close(a.glowLevel(), expect.glowLevel), `${a.glowLevel()}`);
  a.setLookAt(1, 1);
  for (let i = 0; i < 200; i += 1) a.update(16);
  check('mínimo', 'iris', closeAll(a.irisOffset(), expect.irisOffset), `${a.irisOffset()}`);
  a.setMouthOpen(1);
  check('mínimo', 'boca', a.mouthFor('idle') === expect.mouthAt1, a.mouthFor('idle'));
  a.setBlink(0.5);
  check('mínimo', 'ojos', a.eyesFor('idle') === expect.eyesAtBlink05, a.eyesFor('idle'));
  a.setEmotion('divertida');
  check('mínimo', 'emoción', a.expression === expect.emotionFallback, a.expression);
  a.setBlink(0);
  a.setOutline(true); // no hay capa de contorno: no debe pintarse ni fallar
  const got = paint(a);
  check('mínimo', 'dibujo principal', sameDraws(got.main, expect.main), show(got.main));
  check('mínimo', 'dibujo de ojos', sameDraws(got.eyes, expect.eyes, true), show(got.eyes));
  a.dispose();
  let afterDispose = 'sin error';
  try {
    a.setExpression('idle');
    a.setEmotion('divertida');
    a.setMouthOpen(0.5);
    a.setBlink(null);
    a.setGlow(null);
    a.setLookAt(null);
    a.update(16);
  } catch (error) {
    afterDispose = String(error);
  }
  check('mínimo', 'los verbos no fallan tras dispose', afterDispose === 'sin error', afterDispose);
  const after = paint(a);
  check('mínimo', 'dispose deja de pintar', after.main.length === 0, show(after.main));
}

// ---- manifiestos invalidos: que cada caso cambie algo de verdad ---------------------------------------
// El prototipo no valida; aqui solo se comprueba que los datos estan bien
// escritos (la ruta existe o el valor es distinto), para que un caso mal
// tecleado no pase por valido en el esquema del cliente.
{
  const apply = (source, c) => {
    const copy = structuredClone(source);
    const walk = (path) => {
      const keys = path.split('.');
      const last = keys.pop();
      let node = copy;
      for (const key of keys) node = node?.[key];
      return [node, last];
    };
    for (const [path, value] of Object.entries(c.set ?? {})) {
      const [node, last] = walk(path);
      if (node === undefined) return null;
      node[last] = value;
    }
    for (const path of c.remove ?? []) {
      const [node, last] = walk(path);
      if (node === undefined || !Object.hasOwn(node, last)) return null;
      delete node[last];
    }
    return copy;
  };
  const original = JSON.stringify(manifest);
  const names = new Set();
  for (const c of cases.invalidManifests.cases) {
    const changed = apply(manifest, c);
    const ok = changed !== null && JSON.stringify(changed) !== original && !names.has(c.name);
    names.add(c.name);
    check('inválidos', c.name, ok, 'el caso no cambia el manifiesto o está repetido');
  }
}

console.log(`${total - failed} de ${total} comprobaciones correctas`);
process.exit(failed ? 1 : 0);
