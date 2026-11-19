/**
 * Reproductor del motor de capas (ADR 0028 §4): port a TypeScript del
 * prototipo `docs/design/chibi-prototype/player/shiro-chibi.js`.
 *
 * Los casos son los de `test-model/behavior-cases.json`, los mismos que el
 * prototipo pasa con `check-cases.mjs`; se leen de ahí, sin copia. El lienzo
 * se sustituye por un doble que apunta qué imagen se pinta, dónde y con qué
 * opacidad.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseSpriteLayersManifest,
  type SpriteLayersManifest,
} from '../../src/components/Avatar/engines/layers/manifest';
import {
  FADE_MS,
  LayersPlayer,
  type EyeCanvas,
  type LayerImage,
  type LayerImages,
} from '../../src/components/Avatar/engines/layers/player';
import { computeMouthOpen } from '../../src/components/Avatar/useLipSync';

const TEST_MODEL = path.resolve(__dirname, '../../../../docs/design/chibi-prototype/test-model');
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(TEST_MODEL, name), 'utf8'));

// ── dobles del lienzo ────────────────────────────────────────────────────────

interface Draw {
  image: string;
  at: [number, number];
  alpha: number;
  op: string;
}

class FakeContext {
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingQuality = 'low';
  readonly scales: [number, number][] = [];
  /** Nombre de la imagen que «se rompe» al pintarla. */
  failOn: string | null = null;
  private readonly stack: [number, string][] = [];

  constructor(readonly log: Draw[]) {}

  /** Cuántos `save` siguen sin su `restore`. */
  get depth(): number {
    return this.stack.length;
  }

  save(): void {
    this.stack.push([this.globalAlpha, this.globalCompositeOperation]);
  }
  restore(): void {
    const top = this.stack.pop();
    if (top !== undefined) [this.globalAlpha, this.globalCompositeOperation] = top;
  }
  translate(): void {
    // Los casos no miran dónde cae la figura, solo qué se pinta y cómo.
  }
  scale(x: number, y: number): void {
    this.scales.push([x, y]);
  }
  clearRect(): void {
    // El registro de dibujos no se borra: cada caso lee los suyos.
  }
  drawImage(image: { name: string }, x: number, y: number): void {
    if (image.name === this.failOn) throw new Error(`no se pudo pintar ${image.name}`);
    this.log.push({
      image: image.name,
      at: [x, y],
      alpha: this.globalAlpha,
      op: this.globalCompositeOperation,
    });
  }
}

const asContext = (fake: FakeContext): CanvasRenderingContext2D =>
  fake as unknown as CanvasRenderingContext2D;

function parseManifest(raw: unknown): SpriteLayersManifest {
  const result = parseSpriteLayersManifest(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
}

const loadManifest = (name: string): SpriteLayersManifest => parseManifest(readJson(name));

const fakeImage = (name: string): LayerImage => ({ name }) as unknown as LayerImage;

/** Una imagen falsa por cada capa y por cada pieza del manifiesto, con su nombre. */
function fakeImages(source: SpriteLayersManifest): LayerImages {
  const layers = Object.entries(source.layers)
    .filter(([, route]) => route !== undefined)
    .map(([name]) => name);
  return {
    layers: new Map(layers.map((name) => [name, fakeImage(name)])),
    pieces: new Map(Object.keys(source.face.pieces).map((name) => [name, fakeImage(name)])),
  };
}

/** Lienzo de los ojos falso: sus dibujos van a `log` con el nombre `<eyes>`. */
const fakeEyeCanvas =
  (log: Draw[]) =>
  (width: number, height: number): EyeCanvas =>
    ({
      name: '<eyes>',
      width,
      height,
      getContext: () => asContext(new FakeContext(log)),
    }) as unknown as EyeCanvas;

interface Rig {
  player: LayersPlayer;
  eyesLog: Draw[];
}

/** Reproductor con imágenes falsas y sin parpadeo automático, salvo que el caso lo pida. */
function makePlayer(
  manifest: SpriteLayersManifest,
  options: { reducedMotion?: boolean; random?: () => number; images?: LayerImages } = {},
): Rig {
  const { images = fakeImages(manifest), ...rest } = options;
  const eyesLog: Draw[] = [];
  const player = new LayersPlayer(manifest, images, {
    createCanvas: fakeEyeCanvas(eyesLog),
    ...rest,
  });
  player.setBlink(0);
  return { player, eyesLog };
}

/** Entra en una expresión y deja pasar tiempo de sobra para que todo se asiente. */
function settle(player: LayersPlayer, expression: string): void {
  player.setExpression(expression);
  for (let i = 0; i < 200; i += 1) player.update(16);
}

function paint(
  { player, eyesLog }: Rig,
  context = new FakeContext([]),
): { main: Draw[]; eyes: Draw[]; context: FakeContext } {
  eyesLog.length = 0;
  player.setClocks({ time: 0 }); // sin respiración ni fase del pulso
  player.draw(asContext(context), 0, 0, player.width, player.height);
  return { main: context.log, eyes: [...eyesLog], context };
}

// ── casos ────────────────────────────────────────────────────────────────────

type Num = number | 'NaN' | 'Infinity';
const num = (v: Num): number => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v);

interface ExpectedDraw {
  image: string;
  at: [number, number];
  alpha?: number;
  op?: string;
}

interface Cases {
  tolerance: number;
  mouth: { expression: string; mouthOpen: Num; piece: string }[];
  eyes: { expression: string; blink: number; state: string }[];
  autoBlink: {
    expression: string;
    samples: { t: number; blink: number; state: string }[];
    nextIntervalMs: [number, number];
  };
  gaze: {
    expression: string;
    calls: (Num | null)[][];
    look: [number, number];
    irisOffset: [number, number];
  }[];
  gazeSmoothing: { cases: { steps: Num[]; lookX: number }[] };
  expression: {
    unknown: string[];
    unknownFallsBackTo: string;
    fadeMs: number;
    fade: { from: string; to: string; afterMs: number; fade: number; previous: string | null }[];
    emotions: { emotion: string; expression: string }[];
  };
  glow: {
    expression: string;
    timeMs: number;
    sinceEnterMs: number;
    setGlow?: Num;
    level: number;
  }[];
  draw: {
    cases: {
      name: string;
      expression: string;
      from?: string;
      fadeMs?: number;
      blink: number;
      mouthOpen: number;
      outline: boolean;
      setGlow?: number;
      main: ExpectedDraw[];
      eyes?: ExpectedDraw[];
    }[];
  };
  computeMouthOpen: { freq: number[]; gain?: number; open: number }[];
  minimalManifest: {
    manifest: string;
    expect: {
      glowLevel: number;
      irisOffset: [number, number];
      mouthAt1: string;
      eyesAtBlink05: string;
      emotionFallback: string;
      main: ExpectedDraw[];
      eyes: ExpectedDraw[];
    };
  };
}

const cases = readJson('behavior-cases.json') as Cases;
const manifest = loadManifest('avatar.manifest.json');
const DIGITS = 2; // toBeCloseTo(…, 2) = ±0,005; la tolerancia del archivo es 0,001

const near = (got: number, want: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(cases.tolerance);
};
const nearAll = (got: readonly number[], want: readonly number[]): void => {
  expect(got).toHaveLength(want.length);
  got.forEach((value, i) => {
    near(value, want[i] ?? NaN);
  });
};

function expectDraws(got: Draw[], want: ExpectedDraw[], label: string): void {
  expect(
    got.map((d) => d.image),
    label,
  ).toEqual(want.map((d) => d.image));
  want.forEach((w, i) => {
    const g = got[i];
    if (g === undefined) throw new Error(`${label}: falta el dibujo ${String(i)}`);
    nearAll(g.at, w.at);
    if (w.alpha !== undefined) near(g.alpha, w.alpha);
    if (w.op !== undefined) expect(g.op, `${label}: ${w.image}`).toBe(w.op);
  });
}

describe('LayersPlayer — nivel de voz → boca', () => {
  it.each(cases.mouth)('$expression con apertura $mouthOpen → $piece', (c) => {
    const { player } = makePlayer(manifest);
    player.setMouthOpen(num(c.mouthOpen));
    expect(player.mouthFor(c.expression)).toBe(c.piece);
  });

  it.each(cases.computeMouthOpen)('el espectro $freq da apertura $open', (c) => {
    const freq = Uint8Array.from(c.freq);
    near(c.gain === undefined ? computeMouthOpen(freq) : computeMouthOpen(freq, c.gain), c.open);
  });
});

describe('LayersPlayer — expresión + parpadeo → ojos', () => {
  it.each(cases.eyes)('$expression con parpadeo $blink → $state', (c) => {
    const { player } = makePlayer(manifest);
    player.setBlink(c.blink);
    expect(player.eyesFor(c.expression)).toBe(c.state);
  });

  it.each(cases.autoBlink.samples)('parpadeo automático en t=$t → $state', (sample) => {
    const { player } = makePlayer(manifest);
    player.setBlink(null);
    player.setClocks({
      nextBlink: 1000,
      blinkClock: 1000 + sample.t * manifest.face.blink.duration_ms,
    });
    player.update(0);

    near(player.blink, sample.blink);
    expect(player.eyesFor(cases.autoBlink.expression)).toBe(sample.state);
    if (sample.t >= 1) {
      const [min, max] = cases.autoBlink.nextIntervalMs;
      expect(player.clocks.blinkClock).toBe(0);
      expect(player.clocks.nextBlink).toBeGreaterThanOrEqual(min);
      expect(player.clocks.nextBlink).toBeLessThanOrEqual(max);
    }
  });
});

describe('LayersPlayer — mirada', () => {
  it.each(cases.gaze)('$expression tras $calls mira a $look', (c) => {
    const { player } = makePlayer(manifest);
    player.setExpression(c.expression);
    for (const call of c.calls) {
      const [x, y] = call;
      if (x === null || x === undefined) player.setLookAt(null);
      else if (y === null || y === undefined) player.setLookAt(num(x));
      else player.setLookAt(num(x), num(y));
      for (let i = 0; i < 200; i += 1) player.update(16);
    }
    for (let i = 0; i < 200; i += 1) player.update(16);

    nearAll(player.look, c.look);
    nearAll(player.irisOffset(), c.irisOffset);
  });

  it.each(cases.gazeSmoothing.cases)('con pasos $steps la mirada llega a $lookX', (c) => {
    const { player } = makePlayer(manifest);
    player.setLookAt(1, 0);
    for (const dt of c.steps) player.update(num(dt));
    near(player.look[0], c.lookX);
  });
});

describe('LayersPlayer — expresiones', () => {
  it('el fundido dura lo que dice el prototipo', () => {
    expect(FADE_MS).toBe(cases.expression.fadeMs);
  });

  it.each(cases.expression.unknown)('«%s» no es una expresión: cae en idle', (name) => {
    const { player } = makePlayer(manifest);
    player.setExpression('smirk');
    player.setExpression(name);
    expect(player.expression).toBe(cases.expression.unknownFallsBackTo);
  });

  it.each(cases.expression.fade)(
    'de $from a $to, a los $afterMs ms el fundido va por $fade',
    (c) => {
      const { player } = makePlayer(manifest);
      settle(player, c.from);
      player.setExpression(c.to);
      if (c.afterMs > 0) player.update(c.afterMs);
      near(player.fade, c.fade);
      expect(player.previous).toBe(c.previous);
    },
  );

  it('pedir la expresión que ya está no reinicia el fundido', () => {
    const { player } = makePlayer(manifest);
    player.setExpression('smirk');
    player.update(70);
    player.setExpression('smirk');
    expect(player.fade).toBeCloseTo(0.5, DIGITS);
  });

  it.each(cases.expression.emotions)('la emoción «$emotion» da $expression', (c) => {
    const { player } = makePlayer(manifest);
    player.setExpression(c.expression === 'smirk' ? 'idle' : 'smirk');
    player.setEmotion(c.emotion);
    expect(player.expression).toBe(c.expression);
  });
});

describe('LayersPlayer — brillo', () => {
  it.each(cases.glow)('$expression en t=$timeMs (entró hace $sinceEnterMs) brilla $level', (c) => {
    const { player } = makePlayer(manifest);
    player.setExpression(c.expression);
    player.setClocks({ time: c.timeMs, sinceEnter: c.sinceEnterMs });
    if (c.setGlow !== undefined) player.setGlow(num(c.setGlow));
    near(player.glowLevel(), c.level);
  });
});

describe('LayersPlayer — qué se pinta y en qué orden', () => {
  it.each(cases.draw.cases)('$name', (c) => {
    const rig = makePlayer(manifest);
    if (c.from !== undefined) {
      settle(rig.player, c.from);
      rig.player.setExpression(c.expression);
      rig.player.update(c.fadeMs ?? 0);
    } else {
      settle(rig.player, c.expression);
      rig.player.setClocks({ sinceEnter: 1e9 }); // el destello ya se apagó
    }
    rig.player.setBlink(c.blink);
    rig.player.setMouthOpen(c.mouthOpen);
    rig.player.setOutline(c.outline);
    if (c.setGlow !== undefined) rig.player.setGlow(c.setGlow);

    const got = paint(rig);
    expectDraws(got.main, c.main, 'principal');
    if (c.eyes !== undefined) expectDraws(got.eyes, c.eyes, 'ojos');
  });
});

describe('LayersPlayer — manifiesto mínimo y ciclo de vida', () => {
  const { manifest: file, expect: want } = cases.minimalManifest;

  it('usa los valores por defecto', () => {
    const rig = makePlayer(loadManifest(file));
    const { player } = rig;

    near(player.glowLevel(), want.glowLevel);
    player.setLookAt(1, 1);
    for (let i = 0; i < 200; i += 1) player.update(16);
    nearAll(player.irisOffset(), want.irisOffset);
    player.setMouthOpen(1);
    expect(player.mouthFor('idle')).toBe(want.mouthAt1);
    player.setBlink(0.5);
    expect(player.eyesFor('idle')).toBe(want.eyesAtBlink05);
    player.setEmotion('divertida');
    expect(player.expression).toBe(want.emotionFallback);

    player.setBlink(0);
    player.setOutline(true); // no hay capa de contorno: ni se pinta ni falla
    const got = paint(rig);
    expectDraws(got.main, want.main, 'principal');
    expectDraws(got.eyes, want.eyes, 'ojos');
  });

  it('tras dispose los verbos no fallan y ya no se pinta nada', () => {
    const rig = makePlayer(loadManifest(file));
    rig.player.dispose();

    expect(() => {
      rig.player.setExpression('idle');
      rig.player.setEmotion('divertida');
      rig.player.setMouthOpen(0.5);
      rig.player.setBlink(null);
      rig.player.setGlow(null);
      rig.player.setLookAt(null);
      rig.player.update(16);
    }).not.toThrow();
    expect(paint(rig).main).toEqual([]);
  });

  it('si el lienzo de los ojos no se puede crear, lo dice al construirse', () => {
    const createCanvas = (): EyeCanvas =>
      ({ width: 0, height: 0, getContext: () => null }) as unknown as EyeCanvas;
    expect(() => new LayersPlayer(manifest, fakeImages(manifest), { createCanvas })).toThrow(
      /lienzo/,
    );
  });

  it('si faltan imágenes, esas piezas no se pintan y lo demás sí', () => {
    const images: LayerImages = {
      layers: new Map([['base', fakeImage('base')]]),
      pieces: new Map([['mouth_idle', fakeImage('mouth_idle')]]),
    };
    const got = paint(makePlayer(manifest, { images }));

    expect(got.main.map((d) => d.image)).toEqual(['base', 'mouth_idle']);
    // Sin el blanco del ojo no hay nada que recortar: el lienzo de los ojos ni se toca.
    expect(got.eyes).toEqual([]);
  });

  it('una pieza de cara que se llama como una capa no la suplanta', () => {
    const raw = readJson('avatar.manifest.json') as {
      face: { pieces: Record<string, string> };
      expressions: { idle: { brows: string } };
    };
    raw.face.pieces.base = 'assets/brows_idle.png';
    raw.face.pieces.glow = 'assets/mouth_idle.png';
    raw.expressions.idle.brows = 'base';
    const clashing = parseManifest(raw);
    const images: LayerImages = {
      layers: new Map([
        ['base', fakeImage('capa:base')],
        ['glow', fakeImage('capa:glow')],
      ]),
      pieces: new Map([
        ['base', fakeImage('pieza:base')],
        ['glow', fakeImage('pieza:glow')],
      ]),
    };
    const [faceX, faceY] = clashing.face.rect;

    const got = paint(makePlayer(clashing, { images }));

    expect(got.main.map((d) => [d.image, d.at])).toEqual([
      ['capa:base', [0, 0]],
      ['pieza:base', [faceX, faceY]],
      ['capa:glow', [0, 0]],
    ]);
  });
});

describe('LayersPlayer — el lienzo de quien lo usa', () => {
  it('pinta con opacidad y mezcla propias, y deja el lienzo como lo encontró', () => {
    const rig = makePlayer(manifest);
    rig.player.setGlow(2.5); // por encima de 1 el brillo cambia la mezcla a «lighter»
    const context = new FakeContext([]);
    context.globalAlpha = 0.4;
    context.globalCompositeOperation = 'multiply';

    const got = paint(rig, context);

    expect(got.main[0]).toMatchObject({ image: 'base', alpha: 1, op: 'source-over' });
    expect(got.main.at(-1)).toMatchObject({ image: 'glow', op: 'lighter' });
    expect(context.depth).toBe(0);
    expect(context.globalAlpha).toBe(0.4);
    expect(context.globalCompositeOperation).toBe('multiply');
  });

  it('si una imagen falla al pintarse, el error sale y el lienzo queda equilibrado', () => {
    const rig = makePlayer(manifest);
    const context = new FakeContext([]);
    context.failOn = 'glow';

    expect(() => {
      paint(rig, context);
    }).toThrow(/glow/);
    expect(context.depth).toBe(0);
    expect(context.globalAlpha).toBe(1);
  });
});

describe('LayersPlayer — relojes y azar', () => {
  it.each([
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ])('con un azar de %d, la espera del parpadeo cae en esa parte del intervalo', (value, at) => {
    const [min, max] = manifest.face.blink.interval_s;
    const { player } = makePlayer(manifest, { random: () => value });
    near(player.clocks.nextBlink, (min + at * (max - min)) * 1000);
  });

  it.each([NaN, Infinity, -3, 7])('un azar de %d no deja el parpadeo sin fecha', (value) => {
    const [min, max] = manifest.face.blink.interval_s;
    const { player } = makePlayer(manifest, { random: () => value });
    expect(player.clocks.nextBlink).toBeGreaterThanOrEqual(min * 1000);
    expect(player.clocks.nextBlink).toBeLessThanOrEqual(max * 1000);
  });

  it.each([NaN, Infinity, -1])('setClocks ignora %d', (value) => {
    const { player } = makePlayer(manifest);
    player.setClocks({ time: 500, sinceEnter: 400, blinkClock: 300, nextBlink: 2000 });
    player.setClocks({ time: value, sinceEnter: value, blinkClock: value, nextBlink: value });
    expect(player.clocks).toEqual({ time: 500, sinceEnter: 400, blinkClock: 300, nextBlink: 2000 });
  });

  it('lo que se lee es una copia: no cambia cuando el reproductor avanza', () => {
    const { player } = makePlayer(manifest);
    const look = player.look;
    const clocks = player.clocks;
    player.setLookAt(1, 1);
    player.update(500);

    expect(look).toEqual([0, 0]);
    expect(clocks.time).toBe(0);
    expect(player.look[0]).toBeGreaterThan(0.9);
    expect(player.clocks.time).toBe(500);
  });
});

describe('LayersPlayer — reducir el movimiento', () => {
  it('sin la preferencia, respira: el alto se estira un poco con el tiempo', () => {
    const rig = makePlayer(manifest);
    rig.player.setClocks({ time: 1050 }); // un cuarto del periodo de 4,2 s
    const context = new FakeContext([]);
    rig.player.draw(asContext(context), 0, 0, rig.player.width, rig.player.height);
    const [x, y] = context.scales[0] ?? [NaN, NaN];
    expect(y).toBeGreaterThan(x);
  });

  it('con la preferencia, ni respira ni pulsa el brillo', () => {
    const rig = makePlayer(manifest, { reducedMotion: true });
    rig.player.setExpression('thinking'); // su brillo va en pulso
    rig.player.setClocks({ time: 650 });
    const steady = manifest.expressions.thinking?.glow.level ?? NaN;
    near(rig.player.glowLevel(), steady);

    rig.player.setClocks({ time: 1050 });
    const context = new FakeContext([]);
    rig.player.draw(asContext(context), 0, 0, rig.player.width, rig.player.height);
    const [x, y] = context.scales[0] ?? [NaN, NaN];
    expect(y).toBe(x);
  });

  it('el destello al cambiar de expresión se mantiene: es una señal, no un adorno', () => {
    const { player } = makePlayer(manifest, { reducedMotion: true });
    player.setExpression('smirk'); // su brillo entra con un destello
    const steady = manifest.expressions.smirk?.glow.level ?? NaN;
    expect(player.glowLevel()).toBeGreaterThan(steady * 1.5);
  });

  it('la preferencia se puede cambiar con el reproductor en marcha', () => {
    const rig = makePlayer(manifest);
    const stretch = (): number => {
      rig.player.setClocks({ time: 1050 });
      const context = new FakeContext([]);
      rig.player.draw(asContext(context), 0, 0, rig.player.width, rig.player.height);
      const [x, y] = context.scales[0] ?? [NaN, NaN];
      return y / x;
    };

    expect(stretch()).toBeGreaterThan(1);
    rig.player.setReducedMotion(true);
    expect(stretch()).toBe(1);
    rig.player.setReducedMotion(false);
    expect(stretch()).toBeGreaterThan(1);
  });
});
