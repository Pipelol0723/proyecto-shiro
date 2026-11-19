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
  private readonly stack: [number, string][] = [];

  constructor(readonly log: Draw[]) {}

  save(): void {
    this.stack.push([this.globalAlpha, this.globalCompositeOperation]);
  }
  restore(): void {
    const top = this.stack.pop();
    if (top !== undefined) [this.globalAlpha, this.globalCompositeOperation] = top;
  }
  translate(): void {}
  scale(x: number, y: number): void {
    this.scales.push([x, y]);
  }
  clearRect(): void {}
  drawImage(image: { name: string }, x: number, y: number): void {
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

function loadManifest(name: string): SpriteLayersManifest {
  const result = parseSpriteLayersManifest(readJson(name));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
}

interface Rig {
  player: LayersPlayer;
  eyesLog: Draw[];
}

/** Reproductor con imágenes falsas y sin parpadeo automático, salvo que el caso lo pida. */
function makePlayer(
  manifest: SpriteLayersManifest,
  options: { reducedMotion?: boolean } = {},
): Rig {
  const names = [
    ...Object.entries(manifest.layers)
      .filter(([, file]) => file !== undefined)
      .map(([name]) => name),
    ...Object.keys(manifest.face.pieces),
  ];
  const images = new Map(names.map((name) => [name, { name } as unknown as LayerImage]));
  const eyesLog: Draw[] = [];
  const createCanvas = (width: number, height: number): EyeCanvas =>
    ({
      name: '<eyes>',
      width,
      height,
      getContext: () => asContext(new FakeContext(eyesLog)),
    }) as unknown as EyeCanvas;
  const player = new LayersPlayer(manifest, images, { createCanvas, ...options });
  player.setBlink(0);
  return { player, eyesLog };
}

/** Entra en una expresión y deja pasar tiempo de sobra para que todo se asiente. */
function settle(player: LayersPlayer, expression: string): void {
  player.setExpression(expression);
  for (let i = 0; i < 200; i += 1) player.update(16);
}

function paint({ player, eyesLog }: Rig): { main: Draw[]; eyes: Draw[]; context: FakeContext } {
  const main: Draw[] = [];
  eyesLog.length = 0;
  player.setClocks({ time: 0 }); // sin respiración ni fase del pulso
  const context = new FakeContext(main);
  player.draw(asContext(context), 0, 0, player.width, player.height);
  return { main, eyes: [...eyesLog], context };
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
    const images = new Map<string, LayerImage>();
    const createCanvas = (): EyeCanvas =>
      ({ width: 0, height: 0, getContext: () => null }) as unknown as EyeCanvas;
    expect(() => new LayersPlayer(manifest, images, { createCanvas })).toThrow(/lienzo/);
  });

  it('si falta una imagen, esa pieza no se pinta y lo demás sí', () => {
    const images = new Map<string, LayerImage>([
      ['base', { name: 'base' } as unknown as LayerImage],
    ]);
    const eyesLog: Draw[] = [];
    const createCanvas = (width: number, height: number): EyeCanvas =>
      ({
        name: '<eyes>',
        width,
        height,
        getContext: () => asContext(new FakeContext(eyesLog)),
      }) as unknown as EyeCanvas;
    const player = new LayersPlayer(manifest, images, { createCanvas });
    const main: Draw[] = [];
    expect(() => {
      player.draw(asContext(new FakeContext(main)), 0, 0, player.width, player.height);
    }).not.toThrow();
    expect(main.map((d) => d.image)).toContain('base');
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
});
