export interface STTRequest {
  /** Audio a transcribir. Formato dependiente de la impl. */
  audio: Buffer;
  /** Código de idioma ISO 639-1 ('es', 'en', 'fr', ...). Default 'es'. */
  language?: string;
}

export interface STTResult {
  text: string;
  /** Confianza de la transcripción, 0-1. Opcional. */
  confidence?: number;
  /**
   * `true` si la transcripción es definitiva (VAD detectó silencio o fin
   * de stream). `false` si es un resultado parcial — el siguiente chunk
   * puede reemplazarlo o extenderlo.
   */
  isFinal: boolean;
}

/**
 * Contrato de un módulo STT (reconocimiento de voz).
 *
 * Implementación prevista en Fase 4:
 * - `WhisperSTT`: cliente HTTP del microservicio Python con
 *   faster-whisper en `http://localhost:8765`.
 *
 * Diseño streaming-first: el audio es naturalmente streamable, así
 * que `transcribeStream` es el método principal. `transcribe` se
 * mantiene para casos batch (e.g. transcribir un archivo grabado).
 */
export interface ISTTModule {
  readonly id: string;

  /** Transcribe un buffer completo en una sola pasada. */
  transcribe(request: STTRequest): Promise<STTResult>;

  /**
   * Transcripción continua sobre un stream de chunks de audio.
   * Emite resultados parciales (isFinal=false) y eventualmente uno
   * definitivo (isFinal=true) cuando VAD detecta fin de turno.
   */
  transcribeStream?(
    audioChunks: AsyncIterable<Buffer>,
    language?: string,
  ): AsyncIterable<STTResult>;
}
