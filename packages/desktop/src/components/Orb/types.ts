/**
 * Tipos locales del Orb.
 *
 * TODO: Cuando se haga el split browser/node del core (task #18 / ADR
 * pendiente), reemplazar `Emotion` aquí por:
 *   `import type { Emotion } from '@proyecto-shiro/core';`
 *
 * Por ahora se inlinea para evitar pull del barrel del core (que tira
 * de node:fs vía ConfigLoader y rompe el build de Vite).
 */

export type Emotion = 'neutral' | 'alegre' | 'pensativa' | 'sorprendida' | 'triste' | 'enojada';

export interface OrbProps {
  emotion?: Emotion;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  size?: number;
}
