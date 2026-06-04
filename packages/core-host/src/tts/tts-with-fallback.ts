/**
 * TtsWithFallback — implementa `ITTSModule` envolviendo un primary y N
 * fallbacks. Llama a `synthesize` en orden; el primero que devuelve
 * audio gana, los errores intermedios se loguean como warning.
 *
 * Pensado para ADR 0020 (cadena ElevenLabs → SystemTTS): si el primary
 * cae por red, cuota, API key, el fallback toma el turno y Shiro
 * siempre tiene voz. Garantía que el pipeline ve un solo `ITTSModule`
 * sin tener que conocer la cadena.
 */

import type { ITTSModule, Logger, TTSRequest, TTSResponse } from '@proyecto-shiro/core';

export interface TtsWithFallbackOptions {
  primary: ITTSModule;
  /** Lista de fallbacks en orden de preferencia. Puede estar vacía. */
  fallbacks: readonly ITTSModule[];
  logger: Logger;
}

export class TtsWithFallback implements ITTSModule {
  readonly id: string;
  private readonly primary: ITTSModule;
  private readonly fallbacks: readonly ITTSModule[];
  private readonly logger: Logger;

  constructor(options: TtsWithFallbackOptions) {
    this.primary = options.primary;
    this.fallbacks = options.fallbacks;
    this.logger = options.logger.child({ module: 'TtsWithFallback' });
    const chain = [this.primary.id, ...this.fallbacks.map((t) => t.id)].join('→');
    this.id = `tts:chain:${chain}`;
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const chain = [this.primary, ...this.fallbacks];
    let lastErr: unknown;
    for (let i = 0; i < chain.length; i += 1) {
      const tts = chain[i]!;
      try {
        return await tts.synthesize(request);
      } catch (err) {
        lastErr = err;
        const remaining = chain.length - i - 1;
        if (remaining === 0) break;
        this.logger.warn(
          `${tts.id} falló — intentando siguiente en la cadena (quedan ${String(remaining)})`,
          { err },
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`TtsWithFallback: toda la cadena falló (${String(lastErr)})`);
  }
}
