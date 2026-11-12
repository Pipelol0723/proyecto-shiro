/**
 * Reproductor de avatar por capas (prototipo de la chibi de Shiro).
 *
 * Sin dependencias: dibuja en un contexto 2D de canvas. Expone los cinco
 * verbos del contrato de motores propuesto en la etapa 3 de la investigacion:
 *
 *   setExpression(name)   expresion por nombre (idle, smirk, thinking...)
 *   setMouthOpen(0..1)    apertura de la boca, movida por el audio
 *   setBlink(0..1|null)   parpadeo manual; null = automatico
 *   setGlow(0..n|null)    intensidad del brillo; null = la de la expresion
 *   setLookAt(x, y)       no soportado por este modelo: se ignora
 *
 * Todo lo especifico del modelo (archivos, piezas, expresiones) viene del
 * manifiesto, asi que cambiar de modelo es cambiar de manifiesto.
 */

const FADE_MS = 140; // transicion entre expresiones

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    img.src = url;
  });
}

export class LayeredAvatar {
  /** Carga el manifiesto y todas sus imagenes. */
  static async load(manifestUrl) {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`Manifiesto no disponible: ${res.status}`);
    const manifest = await res.json();
    if (manifest.kind !== 'sprite-layers') {
      throw new Error(`Tipo de modelo no soportado: ${manifest.kind}`);
    }
    const base = new URL('.', new URL(manifestUrl, location.href));
    const entries = [...Object.entries(manifest.layers), ...Object.entries(manifest.face.pieces)];
    const images = {};
    await Promise.all(
      entries.map(async ([name, file]) => {
        images[name] = await loadImage(new URL(file, base).href);
      }),
    );
    return new LayeredAvatar(manifest, images);
  }

  constructor(manifest, images) {
    this.manifest = manifest;
    this.images = images;
    this.width = manifest.size[0];
    this.height = manifest.size[1];

    this.expression = 'idle';
    this.previous = null; // expresion de la que venimos, mientras dura la transicion
    this.fade = 1; // 0..1
    this.sinceEnter = 0; // ms desde que entro la expresion actual

    this.mouthOpen = 0;
    this.blinkOverride = null;
    this.glowOverride = null;
    this.outline = false;

    this.time = 0;
    this.blink = 0; // 0 abierto .. 1 cerrado
    this.blinkClock = 0;
    this.nextBlink = this.#randomBlinkInterval();
  }

  // ---- verbos -------------------------------------------------------------
  setExpression(name) {
    if (!(name in this.manifest.expressions)) name = 'idle';
    if (name === this.expression) return;
    this.previous = this.expression;
    this.expression = name;
    this.fade = 0;
    this.sinceEnter = 0;
  }

  /** Atajo: emocion del nucleo (neutral, divertida...) -> expresion. */
  setEmotion(emotion) {
    this.setExpression(this.manifest.emotions[emotion] ?? 'idle');
  }

  setMouthOpen(value) {
    this.mouthOpen = Math.min(1, Math.max(0, value));
  }

  setBlink(value) {
    this.blinkOverride = value === null ? null : Math.min(1, Math.max(0, value));
  }

  setGlow(value) {
    this.glowOverride = value === null ? null : Math.max(0, value);
  }

  setLookAt() {
    // Este modelo no tiene mirada movil.
  }

  setOutline(enabled) {
    this.outline = Boolean(enabled);
  }

  // ---- animacion ----------------------------------------------------------
  #randomBlinkInterval() {
    const [min, max] = this.manifest.face.blink.interval_s;
    return (min + Math.random() * (max - min)) * 1000;
  }

  update(dtMs) {
    this.time += dtMs;
    this.sinceEnter += dtMs;
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dtMs / FADE_MS);
      if (this.fade === 1) this.previous = null;
    }
    // Parpadeo automatico: sube y baja en forma de triangulo.
    const duration = this.manifest.face.blink.duration_ms;
    this.blinkClock += dtMs;
    if (this.blinkClock >= this.nextBlink) {
      const t = (this.blinkClock - this.nextBlink) / duration;
      if (t >= 1) {
        this.blink = 0;
        this.blinkClock = 0;
        this.nextBlink = this.#randomBlinkInterval();
      } else {
        this.blink = t < 0.5 ? t * 2 : (1 - t) * 2;
      }
    }
  }

  #glowLevel() {
    if (this.glowOverride !== null) return this.glowOverride;
    const { level, pattern } = this.manifest.expressions[this.expression].glow;
    if (pattern === 'pulso') {
      return level * (1 + 0.2 * Math.sin((2 * Math.PI * this.time) / 2600));
    }
    if (pattern === 'destello') {
      return level * (1 + 0.6 * Math.exp(-this.sinceEnter / 260));
    }
    return level;
  }

  #eyesFor(expr) {
    const blink = this.blinkOverride ?? this.blink;
    const { half, closed } = this.manifest.face.blink;
    if (blink > 0.7) return closed;
    const own = this.manifest.expressions[expr].eyes;
    // Un ojo ya entornado no pasa por el fotograma medio.
    if (blink > 0.3 && own === 'eyes_open') return half;
    return own;
  }

  #mouthFor(expr) {
    const { mouth_open: open, mouth_thresholds: thresholds } = this.manifest.face;
    let piece = this.manifest.expressions[expr].mouth;
    for (let i = 0; i < thresholds.length; i += 1) {
      if (this.mouthOpen >= thresholds[i]) piece = open[i];
    }
    return piece;
  }

  #drawFace(ctx, expr, alpha) {
    const [fx, fy] = this.manifest.face.rect;
    const e = this.manifest.expressions[expr];
    const put = (name, a) => {
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.drawImage(this.images[name], fx, fy);
    };
    put(this.#eyesFor(expr), alpha);
    put(this.#mouthFor(expr), alpha);
    put(this.manifest.face.blush, alpha * e.blush);
    put(e.brows, alpha);
    ctx.globalAlpha = 1;
  }

  /**
   * Dibuja el avatar ajustado a la caja (x, y, w, h), conservando proporcion
   * y apoyado en el borde inferior.
   */
  draw(ctx, x, y, w, h) {
    const scale = Math.min(w / this.width, h / this.height);
    const dw = this.width * scale;
    const dh = this.height * scale;
    // Respiracion: se estira un pelin desde la base.
    const breath = 1 + 0.004 * Math.sin((2 * Math.PI * this.time) / 4200);
    ctx.save();
    ctx.translate(x + (w - dw) / 2, y + h);
    ctx.scale(scale, scale * breath);
    ctx.translate(0, -this.height);
    ctx.imageSmoothingQuality = 'high';

    if (this.outline) ctx.drawImage(this.images.outline, 0, 0);
    ctx.drawImage(this.images.base, 0, 0);

    if (this.previous && this.fade < 1) {
      // Durante la transicion la cara anterior queda debajo, opaca, y la
      // nueva entra encima: asi no se ve la cara en blanco entre las dos.
      this.#drawFace(ctx, this.previous, 1);
      this.#drawFace(ctx, this.expression, this.fade);
    } else {
      this.#drawFace(ctx, this.expression, 1);
    }

    const glow = this.#glowLevel();
    ctx.globalAlpha = Math.min(1, glow);
    ctx.drawImage(this.images.glow, 0, 0);
    if (glow > 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, glow - 1);
      ctx.drawImage(this.images.glow, 0, 0);
    }
    ctx.restore();
  }
}

/**
 * Convierte el espectro (bytes 0..255) en apertura de boca 0..1.
 * Misma formula que useLipSync.ts del cliente: RMS normalizada por ganancia.
 */
export function computeMouthOpen(freqData, gain = 1.7) {
  if (freqData.length === 0) return 0;
  let sum = 0;
  for (const v of freqData) sum += v * v;
  return Math.min(1, Math.max(0, (Math.sqrt(sum / freqData.length) / 255) * gain));
}
