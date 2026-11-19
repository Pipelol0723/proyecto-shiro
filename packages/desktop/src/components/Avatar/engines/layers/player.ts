/**
 * Reproductor del motor de capas (ADR 0028 §4): dibuja un avatar hecho de
 * imágenes apiladas en un contexto 2D de canvas, sin dependencias.
 *
 * Es el port a TypeScript del prototipo
 * `docs/design/chibi-prototype/player/shiro-chibi.js`, y pasa sus mismos
 * casos (`test-model/behavior-cases.json`). El comportamiento esperado, caso
 * por caso, está en `docs/design/chibi-prototype/expected-behaviors.md`.
 *
 * No sabe de React, de redes ni de archivos: recibe un manifiesto ya validado
 * y sus imágenes ya cargadas. Tampoco tiene reloj propio: quien lo usa llama
 * a `update(dt)` y a `draw(...)` en su bucle de animación, y lo cancela a la
 * vez que llama a `dispose()`.
 */

import type { SpriteLayersManifest } from './manifest';

/** Lo que dura el fundido entre dos expresiones. */
export const FADE_MS = 140;
/** Constante de tiempo del suavizado de la mirada. */
export const LOOK_TAU_MS = 110;

/** Periodo del pulso del brillo y de la respiración, en milisegundos. */
const PULSE_PERIOD_MS = 2600;
const BREATH_PERIOD_MS = 4200;
/** Cuánto se estira la figura al respirar. */
const BREATH_AMOUNT = 0.004;
/** Lo que tarda en apagarse el destello de una expresión al entrar. */
const FLASH_DECAY_MS = 260;

/** Umbrales del parpadeo: por encima del primero se entorna; del segundo, se cierra. */
const BLINK_HALF = 0.3;
const BLINK_CLOSED = 0.7;

/** Cualquier cosa que un contexto 2D sepa pintar. */
export type LayerImage = CanvasImageSource;

/**
 * Las imágenes del modelo, ya cargadas. Van en dos mapas porque en el
 * manifiesto son dos listas de nombres distintas: una pieza de cara puede
 * llamarse `base` o `glow` sin suplantar a la capa.
 */
export interface LayerImages {
  /** Capas de figura completa (`outline`, `base`, `glow`), por su nombre en `layers`. */
  readonly layers: ReadonlyMap<string, LayerImage>;
  /** Piezas de la cara, por su nombre en `face.pieces`. */
  readonly pieces: ReadonlyMap<string, LayerImage>;
}

const NO_IMAGES: LayerImages = { layers: new Map(), pieces: new Map() };

/** El lienzo auxiliar de los ojos: se pinta en él y luego se pinta él. */
export type EyeCanvas = LayerImage & {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
};

export interface LayersPlayerOptions {
  /** Crea el lienzo de los ojos. Por defecto, un `<canvas>` del documento. */
  createCanvas?: (width: number, height: number) => EyeCanvas;
  /** Fuente de azar del parpadeo, de 0 a 1. Por defecto, `Math.random`. */
  random?: () => number;
  /**
   * El sistema pide reducir el movimiento: sin respiración ni pulso del
   * brillo. Se puede cambiar después con `setReducedMotion`.
   */
  reducedMotion?: boolean;
}

/** Relojes internos. Se pueden colocar a mano para pruebas y herramientas. */
export interface PlayerClocks {
  /** Tiempo total desde que se creó; no se reinicia al cambiar de expresión. */
  time: number;
  /** Tiempo desde que entró la expresión actual. */
  sinceEnter: number;
  blinkClock: number;
  /** Espera hasta el siguiente parpadeo automático. */
  nextBlink: number;
}

const CLOCK_KEYS = ['time', 'sinceEnter', 'blinkClock', 'nextBlink'] as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function defaultCreateCanvas(width: number, height: number): EyeCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class LayersPlayer {
  readonly width: number;
  readonly height: number;

  private readonly manifest: SpriteLayersManifest;
  private images: LayerImages;
  private readonly eyeCanvas: EyeCanvas;
  private readonly eyeContext: CanvasRenderingContext2D;
  private readonly random: () => number;
  private reducedMotion: boolean;

  private current = 'idle';
  /** Expresión de la que se viene, mientras dura el fundido. */
  private from: string | null = null;
  private fadeValue = 1;

  private mouthOpen = 0;
  private blinkOverride: number | null = null;
  private glowOverride: number | null = null;
  private outline = false;
  private disposed = false;

  /** Mirada actual (suavizada) y, si la hay, la que fija `setLookAt`. */
  private lookValue: [number, number] = [0, 0];
  private lookOverride: [number, number] | null = null;

  private blinkValue = 0;
  private readonly clock: PlayerClocks;

  /**
   * @throws si no se puede crear el lienzo de los ojos. El motor que lo
   * construye lo trata como un fallo de carga.
   */
  constructor(
    manifest: SpriteLayersManifest,
    images: LayerImages,
    options: LayersPlayerOptions = {},
  ) {
    this.manifest = manifest;
    this.images = images;
    [this.width, this.height] = manifest.size;
    this.random = options.random ?? Math.random;
    this.reducedMotion = options.reducedMotion ?? false;

    const [, , faceWidth, faceHeight] = manifest.face.rect;
    this.eyeCanvas = (options.createCanvas ?? defaultCreateCanvas)(faceWidth, faceHeight);
    const context = this.eyeCanvas.getContext('2d');
    if (context === null) throw new Error('no se pudo crear el lienzo de los ojos');
    this.eyeContext = context;

    this.clock = { time: 0, sinceEnter: 0, blinkClock: 0, nextBlink: this.randomBlinkInterval() };
  }

  // ── estado legible ─────────────────────────────────────────────────────────

  get expression(): string {
    return this.current;
  }
  get previous(): string | null {
    return this.from;
  }
  /** Avance del fundido entre expresiones, de 0 a 1. */
  get fade(): number {
    return this.fadeValue;
  }
  /** Mirada actual, ya suavizada. Es una copia: no cambia al avanzar el reproductor. */
  get look(): readonly [number, number] {
    return [this.lookValue[0], this.lookValue[1]];
  }
  /** Parpadeo automático, de 0 (abierto) a 1 (cerrado). */
  get blink(): number {
    return this.blinkValue;
  }
  /** Los relojes en este instante. Es una copia. */
  get clocks(): Readonly<PlayerClocks> {
    return { ...this.clock };
  }

  /**
   * Coloca los relojes a mano. Para pruebas y herramientas, no para la app.
   * Un valor que no sea un número finito y no negativo se ignora: si entrara,
   * el reloj quedaría en NaN y ningún paso posterior lo recuperaría.
   */
  setClocks(clocks: Partial<PlayerClocks>): void {
    for (const key of CLOCK_KEYS) {
      const value = clocks[key];
      if (value !== undefined && Number.isFinite(value) && value >= 0) this.clock[key] = value;
    }
  }

  // ── verbos (ADR 0028 §1) ───────────────────────────────────────────────────

  setExpression(name: string): void {
    // Solo valen las claves propias: «toString» o «__proto__» no son expresiones.
    const next = Object.hasOwn(this.manifest.expressions, name) ? name : 'idle';
    if (next === this.current) return;
    this.from = this.current;
    this.current = next;
    this.fadeValue = 0;
    this.clock.sinceEnter = 0;
  }

  /** Atajo: emoción del núcleo (`neutral`, `divertida`…) → expresión. */
  setEmotion(emotion: string): void {
    const { emotions } = this.manifest;
    this.setExpression(Object.hasOwn(emotions, emotion) ? (emotions[emotion] ?? 'idle') : 'idle');
  }

  setMouthOpen(value: number): void {
    // Un valor que no es un número cierra la boca: es lo seguro si el audio falla.
    this.mouthOpen = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  }

  setBlink(value: number | null): void {
    if (value === null) this.blinkOverride = null;
    else if (Number.isFinite(value)) this.blinkOverride = clamp(value, 0, 1);
  }

  setGlow(value: number | null): void {
    if (value === null) this.glowOverride = null;
    else if (Number.isFinite(value)) this.glowOverride = Math.max(0, value);
  }

  /**
   * Fija la mirada, de −1 a 1 por eje (`x` positivo, derecha de la pantalla;
   * `y` positivo, arriba). `setLookAt(null)` la suelta: vuelve a mandar la
   * mirada propia de la expresión.
   */
  setLookAt(x: number | null, y = 0): void {
    if (x === null) {
      this.lookOverride = null;
      return;
    }
    // Una coordenada que no es un número deja la mirada como estaba.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.lookOverride = [clamp(x, -1, 1), clamp(y, -1, 1)];
  }

  /** Enciende o apaga el contorno de luz, si el modelo lo trae. */
  setOutline(enabled: boolean): void {
    this.outline = enabled;
  }

  /** Aplica o retira «reducir el movimiento»; la preferencia puede cambiar con la app abierta. */
  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  /**
   * Suelta las imágenes y el lienzo de los ojos. Después ya no pinta nada, y
   * los verbos y `update` no fallan ni tienen efecto visible.
   */
  dispose(): void {
    this.disposed = true;
    this.images = NO_IMAGES;
    this.eyeCanvas.width = 0;
    this.eyeCanvas.height = 0;
  }

  // ── animación ──────────────────────────────────────────────────────────────

  /** Avanza el tiempo `dtMs` milisegundos. */
  update(dtMs: number): void {
    // Un paso que no es un número, o negativo, se ignora: si entrara, la
    // mirada y los relojes quedarían en NaN para siempre.
    if (!Number.isFinite(dtMs) || dtMs < 0) return;
    const { clock } = this;
    clock.time += dtMs;
    clock.sinceEnter += dtMs;

    if (this.fadeValue < 1) {
      this.fadeValue = Math.min(1, this.fadeValue + dtMs / FADE_MS);
      if (this.fadeValue === 1) this.from = null;
    }

    // Mirada: se acerca a su objetivo con suavidad, sin depender de los
    // fotogramas por segundo.
    const target = this.lookOverride ?? this.expressionOf(this.current).gaze;
    const k = 1 - Math.exp(-dtMs / LOOK_TAU_MS);
    this.lookValue[0] += (target[0] - this.lookValue[0]) * k;
    this.lookValue[1] += (target[1] - this.lookValue[1]) * k;

    // Parpadeo automático: sube y baja en forma de triángulo.
    clock.blinkClock += dtMs;
    if (clock.blinkClock >= clock.nextBlink) {
      const t = (clock.blinkClock - clock.nextBlink) / this.manifest.face.blink.duration_ms;
      if (t >= 1) {
        this.blinkValue = 0;
        clock.blinkClock = 0;
        clock.nextBlink = this.randomBlinkInterval();
      } else {
        this.blinkValue = t < 0.5 ? t * 2 : (1 - t) * 2;
      }
    }
  }

  /** Intensidad del brillo en este instante. */
  glowLevel(): number {
    if (this.glowOverride !== null) return this.glowOverride;
    const { level, pattern } = this.expressionOf(this.current).glow;
    if (pattern === 'pulse' && !this.reducedMotion) {
      // El pulso va con el reloj total, no con el de la expresión: no se
      // reinicia al cambiar de cara.
      return level * (1 + 0.2 * Math.sin((2 * Math.PI * this.clock.time) / PULSE_PERIOD_MS));
    }
    if (pattern === 'flash') {
      return level * (1 + 0.6 * Math.exp(-this.clock.sinceEnter / FLASH_DECAY_MS));
    }
    return level;
  }

  /** Estado de ojos que toca dibujar para una expresión, contando el parpadeo. */
  eyesFor(expression: string): string {
    const blink = this.blinkOverride ?? this.blinkValue;
    const { open, half, closed } = this.manifest.face.blink;
    if (blink > BLINK_CLOSED) return closed;
    const own = this.expressionOf(expression).eyes;
    // Un ojo ya entornado no pasa por el fotograma medio.
    if (blink > BLINK_HALF && own === open) return half;
    return own;
  }

  /** Pieza de boca que toca dibujar para una expresión, contando la apertura. */
  mouthFor(expression: string): string {
    const { mouth_open: open, mouth_thresholds: thresholds } = this.manifest.face;
    let piece = this.expressionOf(expression).mouth;
    thresholds.forEach((threshold, i) => {
      const candidate = open[i];
      if (candidate !== undefined && this.mouthOpen >= threshold) piece = candidate;
    });
    return piece;
  }

  /** Desplazamiento del iris en píxeles del modelo (en pantalla, `y` crece hacia abajo). */
  irisOffset(): [number, number] {
    const [maxX, maxY] = this.manifest.face.gaze.max;
    return [this.lookValue[0] * maxX, -this.lookValue[1] * maxY];
  }

  /**
   * Dibuja el avatar ajustado a la caja `(x, y, w, h)`: conserva la
   * proporción, centrado en horizontal y apoyado en el borde inferior.
   *
   * Pinta con su propia opacidad y mezcla, y deja el contexto como lo
   * encontró aunque una imagen falle al pintarse. Ese error sale tal cual:
   * quien lleva el bucle de animación decide qué hacer con el modelo.
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (this.disposed) return;
    const scale = Math.min(w / this.width, h / this.height);
    const drawnWidth = this.width * scale;
    // Respiración: se estira un pelín desde la base.
    const breath = this.reducedMotion
      ? 1
      : 1 + BREATH_AMOUNT * Math.sin((2 * Math.PI * this.clock.time) / BREATH_PERIOD_MS);

    ctx.save();
    try {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.translate(x + (w - drawnWidth) / 2, y + h);
      ctx.scale(scale, scale * breath);
      ctx.translate(0, -this.height);
      ctx.imageSmoothingQuality = 'high';

      if (this.outline) this.putLayer(ctx, 'outline');
      this.putLayer(ctx, 'base');

      if (this.from !== null && this.fadeValue < 1) {
        // Durante el fundido la cara anterior queda debajo, opaca, y la nueva
        // entra encima: así no se ve la cara en blanco entre las dos.
        this.drawFace(ctx, this.from, 1);
        this.drawFace(ctx, this.current, this.fadeValue);
      } else {
        this.drawFace(ctx, this.current, 1);
      }

      const glowImage = this.images.layers.get('glow');
      if (glowImage !== undefined) {
        const glow = this.glowLevel();
        ctx.globalAlpha = Math.min(1, glow);
        ctx.drawImage(glowImage, 0, 0);
        if (glow > 1) {
          // Por encima de 1 el brillo se suma a sí mismo.
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(1, glow - 1);
          ctx.drawImage(glowImage, 0, 0);
        }
      }
    } finally {
      ctx.restore();
    }
  }

  // ── interno ────────────────────────────────────────────────────────────────

  private randomBlinkInterval(): number {
    const [min, max] = this.manifest.face.blink.interval_s;
    // Un azar roto no puede dejar el parpadeo sin fecha: fuera de 0..1 se
    // recorta, y si no es un número cae a mitad del intervalo.
    const drawn = this.random();
    const unit = Number.isFinite(drawn) ? clamp(drawn, 0, 1) : 0.5;
    return (min + unit * (max - min)) * 1000;
  }

  /** La expresión pedida, o `idle` si no existe (el esquema garantiza `idle`). */
  private expressionOf(name: string): SpriteLayersManifest['expressions'][string] {
    const { expressions } = this.manifest;
    const found = Object.hasOwn(expressions, name) ? expressions[name] : expressions.idle;
    if (found === undefined) throw new Error('el manifiesto no tiene la expresión «idle»');
    return found;
  }

  /** Pinta una capa de figura completa. Si no está cargada, no pinta nada. */
  private putLayer(ctx: CanvasRenderingContext2D, name: string): void {
    const image = this.images.layers.get(name);
    if (image !== undefined) ctx.drawImage(image, 0, 0);
  }

  /** Pinta una pieza de la cara en la caja de la cara. Si no está cargada, no pinta nada. */
  private putPiece(ctx: CanvasRenderingContext2D, name: string): void {
    const image = this.images.pieces.get(name);
    if (image === undefined) return;
    const [faceX, faceY] = this.manifest.face.rect;
    ctx.drawImage(image, faceX, faceY);
  }

  /** Ojos en un estado de párpado: blanco, iris desplazado y líneas. */
  private drawEyes(ctx: CanvasRenderingContext2D, state: string, alpha: number): void {
    const { face } = this.manifest;
    const [faceX, faceY, faceWidth, faceHeight] = face.rect;
    const parts = Object.hasOwn(face.eyes, state) ? face.eyes[state] : undefined;
    if (parts === undefined) return;

    ctx.globalAlpha = alpha;
    const { pieces } = this.images;
    const white = parts.white === null ? undefined : pieces.get(parts.white);
    if (white !== undefined) {
      const eye = this.eyeContext;
      eye.globalCompositeOperation = 'source-over';
      eye.clearRect(0, 0, faceWidth, faceHeight);
      eye.drawImage(white, 0, 0);
      const iris = face.iris === undefined ? undefined : pieces.get(face.iris);
      if (iris !== undefined) {
        // El iris solo se pinta donde ya hay blanco: el párpado lo tapa solo.
        eye.globalCompositeOperation = 'source-atop';
        const [dx, dy] = this.irisOffset();
        eye.drawImage(iris, dx, dy);
      }
      ctx.drawImage(this.eyeCanvas, faceX, faceY);
    }
    this.putPiece(ctx, parts.lines);
  }

  private drawFace(ctx: CanvasRenderingContext2D, expression: string, alpha: number): void {
    const { face } = this.manifest;
    const definition = this.expressionOf(expression);
    const putWithAlpha = (name: string, opacity: number): void => {
      if (opacity <= 0) return;
      ctx.globalAlpha = opacity;
      this.putPiece(ctx, name);
    };

    this.drawEyes(ctx, this.eyesFor(expression), alpha);
    putWithAlpha(this.mouthFor(expression), alpha);
    if (face.blush !== undefined) putWithAlpha(face.blush, alpha * definition.blush);
    putWithAlpha(definition.brows, alpha);
    ctx.globalAlpha = 1;
  }
}
