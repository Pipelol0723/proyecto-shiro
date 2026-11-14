import type { Emotion } from '../types/emotions.js';

export interface TTSRequest {
  text: string;
  /**
   * Emoción a expresar en la síntesis. Cada impl mapea la emoción a sus
   * parámetros propios usando el archivo del personaje activo:
   * ElevenLabsTTS la traduce a `tts_stability`, GeminiTTS a una frase de
   * estilo (`tts_style`, ADR 0034 §2) y SystemTTS la ignora.
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
 * Implementaciones (ver [ADR 0020](../../docs/adr/0020-tts-elevenlabs-systemtts-fallback-y-multidevice-diferido.md)
 * y [ADR 0034](../../docs/adr/0034-tts-gemini-voz-disenada.md)):
 * - `GeminiTTS` (cloud, voz diseñada; primaria cuando se active el nivel de pago)
 * - `ElevenLabsTTS` (cloud, alta calidad; primaria hoy y primer respaldo después)
 * - `SystemTTS` (voz del SO, último respaldo offline)
 *
 * El TTS forma parte de una **cadena de fallbacks** que se construye desde
 * `modules.config.yaml` (`active`, `fallback_chain` y la config de cada
 * respaldo en `providers`): si un eslabón lanza error, se prueba el
 * siguiente, y SystemTTS va siempre al final. Kokoro fue descartado por
 * ADR 0020; la voz
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
