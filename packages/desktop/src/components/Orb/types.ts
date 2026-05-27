/**
 * Tipos del Orb.
 *
 * `Emotion` viene del core (entry browser-safe — ADR 0011). Si el core
 * añade emociones nuevas al tipo, el orb se entera por TS y podemos
 * decidir si pintarlas o caer a 'neutral' (ver Orb.tsx).
 */

import type { Emotion } from '@proyecto-shiro/core';

export type { Emotion };

export interface OrbProps {
  emotion?: Emotion;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  size?: number;
}
