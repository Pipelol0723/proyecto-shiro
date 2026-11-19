/**
 * Reproductor de avatar por capas (prototipo de la chibi de Shiro).
 *
 * Sin dependencias: dibuja en un contexto 2D de canvas. Expone los cinco
 * verbos del contrato de motores del ADR 0028:
 *
 *   setExpression(name)   expresion por nombre (idle, smirk, thinking...)
 *   setMouthOpen(0..1)    apertura de la boca, movida por el audio
 *   setBlink(0..1|null)   parpadeo manual; null = automatico
 *   setGlow(0..n|null)    intensidad del brillo; null = la de la expresion
 *   setLookAt(x, y|null)  mirada de -1 a 1; null = la de la expresion
 *
 * Todo lo especifico del modelo (archivos, piezas, expresiones) viene del
 * manifiesto, asi que cambiar de modelo es cambiar de manifiesto. El formato
 * esta descrito en ../manifest-schema.md y el comportamiento esperado, caso
 * por caso, en ../expected-behaviors.md.
 */

export const FADE_MS = 140; // transicion entre expresiones
export const LOOK_TAU_MS = 110; // constante de tiempo del suavizado de la mirada

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    img.src = url;
  });
}

export class LayeredAvatar {
  /** Carga el manifiesto y todas sus imagenes. Si falta una, falla entero. */
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
    this.disposed = false;

    // Mirada: valor actual (suavizado) y, si la hay, la que fija setLookAt.
    this.look = [0, 0];
    this.lookOverride = null;
    // Lienzo auxiliar donde se monta el ojo: blanco + iris recortado por el blanco.
    this.eyeCanvas = document.createElement('canvas');
    this.eyeCanvas.width = manifest.face.rect[2];
    this.eyeCanvas.height = manifest.face.rect[3];
    this.eyeCtx = this.eyeCanvas.getContext('2d');

    this.time = 0;
    this.blink = 0; // 0 abierto .. 1 cerrado
    this.blinkClock = 0;
    this.nextBlink = this.#randomBlinkInterval();
  }

  // ---- verbos -------------------------------------------------------------
  setExpression(name) {
    // Solo valen las claves propias: "toString" o "__proto__" no son expresiones.
    if (!Object.hasOwn(this.manifest.expressions, name)) name = 'idle';
    if (name === this.expression) return;
    this.previous = this.expression;
    this.expression = name;
    this.fade = 0;
    this.sinceEnter = 0;
  }

  /** Atajo: emocion del nucleo (neutral, divertida...) -> expresion. */
  setEmotion(emotion) {
    const emotions = this.manifest.emotions ?? {};
    this.setExpression(Object.hasOwn(emotions, emotion) ? emotions[emotion] : 'idle');
  }

  setMouthOpen(value) {
    // Un valor que no es un numero cierra la boca: es lo seguro si el audio falla.
    this.mouthOpen = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }

  setBlink(value) {
    if (value === null) this.blinkOverride = null;
    else if (Number.isFinite(value)) this.blinkOverride = Math.min(1, Math.max(0, value));
  }

  setGlow(value) {
    if (value === null) this.glowOverride = null;
    else if (Number.isFinite(value)) this.glowOverride = Math.max(0, value);
  }

  /**
   * Fija la mirada en coordenadas de -1 a 1 (x positivo = derecha de la
   * pantalla, y positivo = arriba). setLookAt(null) la suelta: vuelve a
   * mandar la mirada propia de la expresion.
   */
  setLookAt(x, y = 0) {
    if (x === null) {
      this.lookOverride = null;
      return;
    }
    // Una coordenada que no es un numero deja la mirada como estaba.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const clamp = (v) => Math.min(1, Math.max(-1, v));
    this.lookOverride = [clamp(x), clamp(y)];
  }

  setOutline(enabled) {
    this.outline = Boolean(enabled);
  }

  /**
   * Suelta las imagenes y el lienzo auxiliar. Despues de llamarlo el avatar
   * ya no dibuja nada: es lo que usara el cambio de modelo en caliente.
   * El motor no tiene temporizadores propios: el bucle de animacion es de
   * quien lo usa, y le toca cancelarlo a la vez.
   */
  dispose() {
    this.disposed = true;
    this.images = {};
    this.eyeCanvas.width = 0;
    this.eyeCanvas.height = 0;
  }

  // ---- animacion ----------------------------------------------------------
  #randomBlinkInterval() {
    const [min, max] = this.manifest.face.blink.interval_s ?? [2.5, 6];
    return (min + Math.random() * (max - min)) * 1000;
  }

  update(dtMs) {
    // Un paso que no es un numero, o negativo, se ignora: si entrara, la
    // mirada y los relojes quedarian en NaN para siempre.
    if (!Number.isFinite(dtMs) || dtMs < 0) return;
    this.time += dtMs;
    this.sinceEnter += dtMs;
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dtMs / FADE_MS);
      if (this.fade === 1) this.previous = null;
    }
    // Mirada: se acerca a su objetivo con suavidad, sin saltos.
    const target = this.lookOverride ?? this.manifest.expressions[this.expression].gaze ?? [0, 0];
    const k = 1 - Math.exp(-dtMs / LOOK_TAU_MS);
    this.look[0] += (target[0] - this.look[0]) * k;
    this.look[1] += (target[1] - this.look[1]) * k;
    // Parpadeo automatico: sube y baja en forma de triangulo.
    const duration = this.manifest.face.blink.duration_ms ?? 130;
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

  /** Intensidad del brillo en este instante (publico para poder probarlo). */
  glowLevel() {
    if (this.glowOverride !== null) return this.glowOverride;
    const { level = 1, pattern = 'steady' } = this.manifest.expressions[this.expression].glow ?? {};
    if (pattern === 'pulse') {
      // El pulso va con el reloj total del motor, no con el de la expresion:
      // no se reinicia al cambiar de cara.
      return level * (1 + 0.2 * Math.sin((2 * Math.PI * this.time) / 2600));
    }
    if (pattern === 'flash') {
      return level * (1 + 0.6 * Math.exp(-this.sinceEnter / 260));
    }
    return level;
  }

  /** Estado de ojos que toca dibujar para una expresion, contando el parpadeo. */
  eyesFor(expr) {
    const blink = this.blinkOverride ?? this.blink;
    const { open = 'eyes_open', half, closed } = this.manifest.face.blink;
    if (blink > 0.7) return closed;
    const own = this.manifest.expressions[expr].eyes;
    // Un ojo ya entornado no pasa por el fotograma medio.
    if (blink > 0.3 && own === open) return half;
    return own;
  }

  /** Pieza de boca que toca dibujar para una expresion, contando la apertura. */
  mouthFor(expr) {
    const { mouth_open: open, mouth_thresholds: thresholds } = this.manifest.face;
    let piece = this.manifest.expressions[expr].mouth;
    for (let i = 0; i < thresholds.length; i += 1) {
      if (this.mouthOpen >= thresholds[i]) piece = open[i];
    }
    return piece;
  }

  /** Desplazamiento del iris en pixeles del modelo (y de pantalla: hacia abajo). */
  irisOffset() {
    const [maxX, maxY] = this.manifest.face.gaze?.max ?? [0, 0];
    return [this.look[0] * maxX, -this.look[1] * maxY];
  }

  /** Ojos en un estado de parpado: blanco, iris desplazado y lineas. */
  #drawEyes(ctx, state, alpha) {
    const face = this.manifest.face;
    const [fx, fy, fw, fh] = face.rect;
    const parts = face.eyes[state];
    ctx.globalAlpha = alpha;
    if (parts.white) {
      const c = this.eyeCtx;
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, fw, fh);
      c.drawImage(this.images[parts.white], 0, 0);
      if (face.iris) {
        // El iris solo se pinta donde hay blanco: el parpado lo tapa solo.
        c.globalCompositeOperation = 'source-atop';
        const [dx, dy] = this.irisOffset();
        c.drawImage(this.images[face.iris], dx, dy);
      }
      ctx.drawImage(this.eyeCanvas, fx, fy);
    }
    ctx.drawImage(this.images[parts.lines], fx, fy);
  }

  #drawFace(ctx, expr, alpha) {
    const [fx, fy] = this.manifest.face.rect;
    const e = this.manifest.expressions[expr];
    const put = (name, a) => {
      if (a <= 0) return;
      ctx.globalAlpha = a;
      ctx.drawImage(this.images[name], fx, fy);
    };
    this.#drawEyes(ctx, this.eyesFor(expr), alpha);
    put(this.mouthFor(expr), alpha);
    if (this.manifest.face.blush) put(this.manifest.face.blush, alpha * (e.blush ?? 0));
    put(e.brows, alpha);
    ctx.globalAlpha = 1;
  }

  /**
   * Dibuja el avatar ajustado a la caja (x, y, w, h), conservando proporcion
   * y apoyado en el borde inferior.
   */
  draw(ctx, x, y, w, h) {
    if (this.disposed) return;
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

    if (this.outline && this.images.outline) ctx.drawImage(this.images.outline, 0, 0);
    ctx.drawImage(this.images.base, 0, 0);

    if (this.previous && this.fade < 1) {
      // Durante la transicion la cara anterior queda debajo, opaca, y la
      // nueva entra encima: asi no se ve la cara en blanco entre las dos.
      this.#drawFace(ctx, this.previous, 1);
      this.#drawFace(ctx, this.expression, this.fade);
    } else {
      this.#drawFace(ctx, this.expression, 1);
    }

    if (this.images.glow) {
      const glow = this.glowLevel();
      ctx.globalAlpha = Math.min(1, glow);
      ctx.drawImage(this.images.glow, 0, 0);
      if (glow > 1) {
        // Por encima de 1 el brillo se suma a si mismo.
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, glow - 1);
        ctx.drawImage(this.images.glow, 0, 0);
      }
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
