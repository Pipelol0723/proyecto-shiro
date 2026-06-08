/**
 * Mapeo de emoción → expresión facial del avatar Live2D (ADR 0021 §6).
 *
 * **Dos mecanismos, uno activo hoy:**
 *
 * 1. **Por parámetros** (`EMOTION_FACE_TARGETS`, ACTIVO): el modelo Hiyori
 *    placeholder **no trae archivos de expresión** (`.exp3.json`), pero sí
 *    los parámetros faciales estándar de Cubism (`ParamMouthForm`,
 *    `ParamEyeLSmile`, `ParamBrowLY`, …). Mapeamos cada emoción a un set de
 *    valores y los interpolamos sobre el modelo. Esto es lo que se ve hoy.
 *
 * 2. **Por nombre de expresión** (`EMOTION_EXPRESSION_NAME`, RESERVADO): la
 *    "conexión" para cuando llegue un modelo con `.exp3.json`. Entonces, en
 *    vez de aplicar parámetros, se llamará `model.expression(nombre)` con
 *    estos nombres y se podrá borrar `EMOTION_FACE_TARGETS`. Ver el seam en
 *    `useAvatarExpression` / `Live2DCanvas`.
 *
 * Ningún parámetro de expresión pisa al lip-sync (`ParamMouthOpenY`) ni al
 * parpadeo (`ParamEyeLOpen/ROpen`): usamos la *forma* de boca/ojos
 * (`MouthForm`, `EyeLSmile`) y las cejas, que son independientes.
 */

import type { Emotion } from '@proyecto-shiro/core';

/**
 * Nombre lógico de expresión por emoción — RESERVADO para `model.expression()`
 * cuando el modelo definitivo traiga `.exp3.json`. Espeja el `avatar_expression`
 * del character YAML + los alias de Hiyori del server (ver
 * `hiyori-expression-aliases.ts`). Hoy no se usa (Hiyori no tiene expresiones).
 */
export const EMOTION_EXPRESSION_NAME: Readonly<Record<Emotion, string>> = {
  neutral: 'default',
  divertida: 'smile',
  pensativa: 'default',
  molesta: 'anger',
  vulnerable: 'default',
};

/**
 * Parámetros faciales que tocan las expresiones. Lista cerrada para que el
 * loop de interpolación sepa qué devolver a 0 al cambiar de emoción.
 */
export const FACE_PARAM_IDS = [
  'ParamMouthForm',
  'ParamEyeLSmile',
  'ParamEyeRSmile',
  'ParamCheek',
  'ParamBrowLY',
  'ParamBrowRY',
  'ParamBrowLForm',
  'ParamBrowRForm',
  'ParamEyeBallX',
] as const;

type FaceParamId = (typeof FACE_PARAM_IDS)[number];

/**
 * Valores objetivo por emoción. Solo los parámetros que cambian respecto a
 * neutral; el resto se asume 0 (cara en reposo). Valores en el rango nativo
 * de Cubism (Cubism clampa, así que pasarse no rompe). Tunéalos a ojo.
 */
const EMOTION_FACE_TARGETS: Readonly<Record<Emotion, Partial<Record<FaceParamId, number>>>> = {
  neutral: {},
  divertida: {
    ParamMouthForm: 1,
    ParamEyeLSmile: 0.7,
    ParamEyeRSmile: 0.7,
    ParamCheek: 0.4,
    ParamBrowLY: 0.2,
    ParamBrowRY: 0.2,
  },
  pensativa: {
    ParamMouthForm: -0.15,
    ParamBrowLY: -0.25,
    ParamBrowRY: -0.25,
    ParamEyeBallX: -0.3,
  },
  molesta: {
    ParamMouthForm: -0.6,
    ParamBrowLY: -0.8,
    ParamBrowRY: -0.8,
    ParamBrowLForm: -0.8,
    ParamBrowRForm: -0.8,
  },
  vulnerable: {
    ParamMouthForm: -0.3,
    ParamBrowLY: 0.6,
    ParamBrowRY: 0.6,
    ParamBrowLForm: 0.4,
    ParamBrowRForm: 0.4,
  },
};

/**
 * Resuelve los valores objetivo de TODOS los `FACE_PARAM_IDS` para una
 * emoción: los que la emoción define, y 0 para el resto (vuelta a neutral).
 * Pura — fácil de testear.
 */
export function resolveFaceParams(emotion: Emotion): Record<FaceParamId, number> {
  const targets = EMOTION_FACE_TARGETS[emotion] ?? {};
  const out = {} as Record<FaceParamId, number>;
  for (const id of FACE_PARAM_IDS) {
    out[id] = targets[id] ?? 0;
  }
  return out;
}
