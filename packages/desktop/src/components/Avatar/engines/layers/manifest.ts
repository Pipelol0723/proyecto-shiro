/**
 * Esquema de `avatar.manifest.json` para el motor de capas
 * (`kind: "sprite-layers"`, ADR 0028 §4), versión 0.2 del formato.
 *
 * La especificación está en `docs/design/chibi-prototype/manifest-schema.md`,
 * y sus casos en `test-model/behavior-cases.json`, que los tests leen sin
 * copia. Si el documento y este archivo difieren, manda este archivo y se
 * corrige el documento.
 *
 * Un manifiesto llega de un archivo que no escribe la app: nada de lo que trae
 * se usa sin pasar por aquí.
 */

import { z } from 'zod';
import {
  MAX_NAME_LENGTH,
  assetPath,
  findReservedKeys,
  manifestHeaderShape,
  mapKey,
  toManifestIssues,
  type ManifestResult,
} from '../manifest-header';

export const SPRITE_LAYERS_KIND = 'sprite-layers';

/** Versiones del formato que este motor sabe leer. */
const FORMAT_VERSION = '0.2';

/**
 * Lado máximo de una imagen del modelo. Por encima, el lienzo de los ojos no
 * se puede crear y el motor fallaría al pintar.
 */
const MAX_SIDE = 8192;
/** Topes de los mapas y listas: un manifiesto no debe poder pedir miles de imágenes. */
const MAX_PIECES = 256;
const MAX_ENTRIES = 64;

const positiveInt = z.number().int().positive().max(MAX_SIDE);
const nonNegativeInt = z.number().int().nonnegative().max(MAX_SIDE);
/** Nombre de una pieza o de un estado de ojos, citado desde otro campo. */
const name = z.string().min(1).max(MAX_NAME_LENGTH);
/** Mapa abierto con un tope de entradas. */
const boundedRecord = <T extends z.ZodType>(value: T, max: number) =>
  z.record(mapKey, value).refine((map) => Object.keys(map).length <= max, {
    message: `como mucho ${String(max)} entradas`,
  });
/** Una coordenada de mirada, de −1 a 1. */
const unit = z.number().min(-1).max(1);

const EyeStateSchema = z.strictObject({
  /** Hueco visible del ojo. `null` = ojo cerrado: no se pinta ni blanco ni iris. */
  white: name.nullable(),
  /** Pestañas y contorno de ese estado. Va encima del iris. */
  lines: name,
});

/** Espera entre parpadeos, en segundos: ni un parpadeo continuo ni uno que nunca llega. */
const blinkWait = z.number().min(0.1).max(600);

const BlinkSchema = z.strictObject({
  /** Estado «del todo abierto»: solo las expresiones que lo usan pasan por el medio. */
  open: name.default('eyes_open'),
  half: name,
  closed: name,
  /** Espera al azar, en segundos, entre un parpadeo automático y el siguiente. */
  interval_s: z.tuple([blinkWait, blinkWait]).default([2.5, 6]),
  duration_ms: z.number().min(10).max(5000).default(130),
});

const FaceSchema = z.strictObject({
  /** Caja de la cara dentro de la figura: `[x, y, ancho, alto]`. */
  rect: z.tuple([nonNegativeInt, nonNegativeInt, positiveInt, positiveInt]),
  /** Todas las imágenes de la cara; el resto del manifiesto las nombra por su clave. */
  pieces: boundedRecord(assetPath, MAX_PIECES),
  eyes: boundedRecord(EyeStateSchema, MAX_ENTRIES),
  iris: name.optional(),
  /** Recorrido máximo del iris, en píxeles del modelo, cuando la mirada vale 1. */
  gaze: z
    .strictObject({ max: z.tuple([z.number().nonnegative(), z.number().nonnegative()]) })
    .default({ max: [0, 0] }),
  blink: BlinkSchema,
  /** Bocas abiertas, de menor a mayor apertura. */
  mouth_open: z.array(name).max(MAX_ENTRIES),
  /** Apertura a partir de la cual entra cada boca, cada una en (0, 1]. */
  mouth_thresholds: z.array(z.number().gt(0).lte(1)).max(MAX_ENTRIES),
  blush: name.optional(),
});

const GlowSchema = z.strictObject({
  level: z.number().nonnegative().default(1),
  pattern: z.enum(['steady', 'pulse', 'flash']).default('steady'),
});

const ExpressionSchema = z.strictObject({
  eyes: name,
  brows: name,
  mouth: name,
  blush: z.number().min(0).max(1).default(0),
  /** Hacia dónde mira la expresión cuando nadie llama a `setLookAt`. */
  gaze: z.tuple([unit, unit]).default([0, 0]),
  glow: GlowSchema.default({ level: 1, pattern: 'steady' }),
});

export const SpriteLayersManifestSchema = z
  .strictObject({
    ...manifestHeaderShape,
    kind: z.literal(SPRITE_LAYERS_KIND),
    version: z.literal(FORMAT_VERSION),
    /** Tamaño de las capas de figura completa: `[ancho, alto]`. */
    size: z.tuple([positiveInt, positiveInt]),
    // `z.object` y no `strictObject`: una capa que este motor no conoce se
    // ignora y no se carga, para que un motor más nuevo pueda usarla.
    layers: z.object({
      base: assetPath,
      glow: assetPath.optional(),
      outline: assetPath.optional(),
    }),
    face: FaceSchema,
    expressions: boundedRecord(ExpressionSchema, MAX_ENTRIES),
    /** Emoción del núcleo → expresión. Una emoción ausente cae en `idle`. */
    emotions: boundedRecord(name, MAX_ENTRIES).default({}),
  })
  .superRefine((manifest, ctx) => {
    const { face, expressions, emotions, size } = manifest;
    const issue = (path: (string | number)[], message: string): void => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const piece = (name: string | undefined, path: (string | number)[]): void => {
      if (name !== undefined && !Object.hasOwn(face.pieces, name)) {
        issue(path, `la pieza «${name}» no está en face.pieces`);
      }
    };
    const eyeState = (name: string, path: (string | number)[]): void => {
      if (!Object.hasOwn(face.eyes, name)) {
        issue(path, `el estado de ojos «${name}» no está en face.eyes`);
      }
    };

    // 1. Toda pieza citada existe.
    for (const [state, eyes] of Object.entries(face.eyes)) {
      piece(eyes.white ?? undefined, ['face', 'eyes', state, 'white']);
      piece(eyes.lines, ['face', 'eyes', state, 'lines']);
    }
    piece(face.iris, ['face', 'iris']);
    piece(face.blush, ['face', 'blush']);
    face.mouth_open.forEach((name, i) => {
      piece(name, ['face', 'mouth_open', i]);
    });
    for (const [name, expression] of Object.entries(expressions)) {
      piece(expression.brows, ['expressions', name, 'brows']);
      piece(expression.mouth, ['expressions', name, 'mouth']);
      // 2. Todo estado de ojos citado existe.
      eyeState(expression.eyes, ['expressions', name, 'eyes']);
    }
    // El valor por defecto de `open` también tiene que existir.
    eyeState(face.blink.open, ['face', 'blink', 'open']);
    eyeState(face.blink.half, ['face', 'blink', 'half']);
    eyeState(face.blink.closed, ['face', 'blink', 'closed']);

    // 3 y 4. Las emociones apuntan a expresiones que existen, e `idle` existe.
    for (const [emotion, expression] of Object.entries(emotions)) {
      if (!Object.hasOwn(expressions, expression)) {
        issue(['emotions', emotion], `la expresión «${expression}» no existe`);
      }
    }
    if (!Object.hasOwn(expressions, 'idle')) {
      issue(['expressions'], 'falta la expresión «idle»');
    }

    // 5. Bocas y umbrales van a la par, y los umbrales crecen.
    if (face.mouth_open.length !== face.mouth_thresholds.length) {
      issue(['face', 'mouth_thresholds'], 'debe haber un umbral por cada boca abierta');
    }
    face.mouth_thresholds.forEach((threshold, i) => {
      const previous = face.mouth_thresholds[i - 1];
      if (previous !== undefined && threshold <= previous) {
        issue(['face', 'mouth_thresholds', i], 'los umbrales deben crecer');
      }
    });

    // 6. La cara cabe en la figura.
    const [x, y, width, height] = face.rect;
    if (x + width > size[0] || y + height > size[1]) {
      issue(['face', 'rect'], 'la caja de la cara no cabe en la figura');
    }

    // El iris no puede desplazarse más de lo que mide la cara.
    if (face.gaze.max[0] > width || face.gaze.max[1] > height) {
      issue(
        ['face', 'gaze', 'max'],
        'el recorrido de la mirada no puede superar la caja de la cara',
      );
    }

    if (face.blink.interval_s[0] > face.blink.interval_s[1]) {
      issue(['face', 'blink', 'interval_s'], 'el mínimo no puede superar al máximo');
    }
  });

/** Manifiesto ya validado y con los valores por defecto puestos. */
export type SpriteLayersManifest = z.infer<typeof SpriteLayersManifestSchema>;

/**
 * Valida un manifiesto ya leído como JSON. Nunca lanza: devuelve el
 * manifiesto con sus valores por defecto, o la lista de problemas.
 */
export function parseSpriteLayersManifest(raw: unknown): ManifestResult<SpriteLayersManifest> {
  const reserved = findReservedKeys(raw);
  if (reserved.length > 0) return { ok: false, issues: reserved };
  const result = SpriteLayersManifestSchema.safeParse(raw);
  if (result.success) return { ok: true, manifest: result.data };
  return { ok: false, issues: toManifestIssues(result.error) };
}
