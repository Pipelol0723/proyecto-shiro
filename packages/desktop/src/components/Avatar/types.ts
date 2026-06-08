/**
 * Props del componente `<Avatar>`.
 *
 * Mismo contrato que `<Orb>` (ADR 0009) — el Avatar es drop-in
 * replacement: cualquier consumidor que pase emoción / speaking /
 * listening / thinking / size recibe el render correcto sin saber si
 * va a salir un orbe o un Live2D.
 */

import type { Emotion } from '@proyecto-shiro/core';

export interface AvatarProps {
  emotion?: Emotion;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  size?: number;
  /**
   * El `<audio>` del TTS que está sonando (lo expone `useTtsPlayback`),
   * para el lip-sync del avatar Live2D (ADR 0021 §5). El Orbe lo ignora.
   * `null` = nada sonando o cliente muteado → boca cerrada.
   */
  audioElement?: HTMLAudioElement | null;
}
