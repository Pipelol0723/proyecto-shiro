import type { Emotion } from '../types/emotions.js';

export interface TTSRequest {
  text: string;
  /**
   * Emoción a expresar en la síntesis. Cada impl mapea la emoción a sus
   * parámetros propios (estabilidad, similarity, pitch, etc.) usando el
   * archivo del personaje activo.
   */
  emotion?: Emotion;
  /**
   * ID de voz específico del proveedor. Si se omite, la impl usa la voz
   * por defecto configurada en `modules.config.yaml`.
   */
  voiceId?: string;
}

export interface TTSResponse {
  /** Audio sintetizado. El formato (WAV, MP3, OGG) depende de la impl. */
  audio: Buffer;
  /** Duración en milisegundos. Útil para sincronizar el lip sync. */
  duration?: number;
  /** Mime type del buffer ('audio/wav', 'audio/mpeg', etc.). */
  mimeType: string;
}

/**
 * Contrato de un módulo TTS (síntesis de voz).
 *
 * Implementaciones previstas (ver [ADR 0020](../../docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)):
 * - `ElevenLabsTTS` (cloud, alta calidad — primary)
 * - `SystemTTS` (voz del SO, fallback offline)
 *
 * El TTS forma parte de una **cadena de fallbacks** definida en
 * `modules.config.yaml`: si ElevenLabsTTS lanza error, el orchestrator
 * intenta con SystemTTS. Kokoro fue descartado por ADR 0020; la voz
 * sintética estilo UTAU queda diferida a un hito futuro post-5080
 * (será otro microservicio aparte, mismo patrón que Whisper).
 */
export interface ITTSModule {
  readonly id: string;

  /** Sintetiza texto completo, devuelve buffer completo. */
  synthesize(request: TTSRequest): Promise<TTSResponse>;

  /**
   * Síntesis por chunks. Cada chunk es un buffer de audio reproducible
   * por sí mismo (o concatenable, según la impl).
   *
   * Habilita el avatar a empezar a hablar mientras el LLM aún streamea.
   */
  synthesizeStream?(request: TTSRequest): AsyncIterable<Buffer>;
}
