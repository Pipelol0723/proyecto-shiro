/**
 * Cabecera común de `avatar.manifest.json` y piezas de esquema que comparten
 * todos los motores del avatar.
 *
 * - ADR 0028 §2: cada modelo trae un manifiesto junto a sus archivos.
 * - ADR 0035 §1: la cabecera dice la forma, el coste y las capacidades, para
 *   elegir modelo sin cargar el motor ni las imágenes.
 */

import { z } from 'zod';

/** Las tres formas de Shiro entre las que se elige (ADR 0035 §1). */
export const AVATAR_FORMS = ['chibi', '2d', '3d'] as const;
export type AvatarForm = (typeof AVATAR_FORMS)[number];

export const AvatarCostSchema = z.strictObject({
  /** Orden grueso para «elige uno más ligero». Lo declara quien hace el modelo. */
  tier: z.enum(['light', 'medium', 'heavy']),
  needs_webgl: z.boolean().optional(),
  /** Memoria aproximada con todo cargado. Estimación, no medida. */
  memory_mb: z.number().nonnegative().optional(),
  download_kb: z.number().nonnegative().optional(),
});

export const AvatarCapabilitiesSchema = z.strictObject({
  look_at: z.boolean().optional(),
  glow: z.boolean().optional(),
  body_motion: z.boolean().optional(),
  /** Cuánto cuerpo trae: solo sirve para colocarlo. */
  framing: z.enum(['full-body', 'torso', 'bust']).optional(),
});

/** Campos de cabecera que valen para cualquier motor (sin `kind`, que es de cada uno). */
export const manifestHeaderShape = {
  name: z.string().min(1),
  provisional: z.boolean().default(false),
  credits: z.string().default(''),
  /** Obsoleto: era una nota; el orden de pintado lo fija el motor. Se acepta y se ignora. */
  draw_order: z.array(z.string()).optional(),
  form: z.enum(AVATAR_FORMS).optional(),
  cost: AvatarCostSchema.optional(),
  capabilities: AvatarCapabilitiesSchema.optional(),
};

/**
 * Nombres que no pueden ser clave de un mapa del manifiesto: al copiarlos a un
 * objeto pisarían su prototipo, y `nombre in mapa` los daría por existentes.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Clave de un mapa abierto (piezas, estados de ojos, expresiones, emociones). */
export const mapKey = z
  .string()
  .min(1)
  .refine((key) => !FORBIDDEN_KEYS.has(key), { message: 'nombre reservado' });

/**
 * `true` si la ruta se queda dentro de la carpeta del manifiesto (regla 7 del
 * esquema): relativa, con `/`, sin `..`, sin barra inicial ni invertida, sin
 * letra de unidad y sin esquema.
 *
 * Tampoco admite `%`, `?` ni `#`: al resolver la ruta como URL, `%2e%2e`
 * vuelve a ser `..`, y una consulta o un fragmento no nombran un archivo.
 */
export function isSafeRelativePath(route: string): boolean {
  if (route === '' || /[\\%?#]/.test(route)) return false;
  // Un esquema (`https:`, `data:`, `file:`) o una letra de unidad (`C:`).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(route)) return false;
  return route.split('/').every((segment) => segment !== '' && segment !== '..');
}

/** Ruta de una imagen del modelo, relativa a la carpeta del manifiesto. */
export const assetPath = z.string().refine(isSafeRelativePath, {
  message: 'la ruta debe ser relativa y quedarse dentro de la carpeta del modelo',
});

/** Un problema del manifiesto: dónde está (ruta con puntos) y qué pasa. */
export interface ManifestIssue {
  path: string;
  message: string;
}

export type ManifestResult<T> =
  | { readonly ok: true; readonly manifest: T }
  | { readonly ok: false; readonly issues: ManifestIssue[] };

/** Profundidad máxima que se recorre buscando claves reservadas. */
const MAX_SCAN_DEPTH = 8;

/**
 * Busca claves reservadas en cualquier nivel del JSON. `JSON.parse` crea
 * `__proto__` como propiedad propia, y zod la descarta sin avisar: el
 * manifiesto pasaría «limpio» con una pieza menos. Aquí se rechaza.
 */
export function findReservedKeys(raw: unknown, path: string[] = []): ManifestIssue[] {
  if (typeof raw !== 'object' || raw === null || path.length >= MAX_SCAN_DEPTH) return [];
  const issues: ManifestIssue[] = [];
  for (const key of Object.getOwnPropertyNames(raw)) {
    const here = [...path, key];
    if (!Array.isArray(raw) && FORBIDDEN_KEYS.has(key)) {
      issues.push({ path: here.join('.'), message: 'nombre reservado' });
      continue;
    }
    issues.push(...findReservedKeys((raw as Record<string, unknown>)[key], here));
  }
  return issues;
}

/** Pasa los problemas de zod a la forma que usa el resto del cliente. */
export function toManifestIssues(error: z.ZodError): ManifestIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}
