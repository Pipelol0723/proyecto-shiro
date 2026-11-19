/**
 * Qué decirle al usuario cuando falla el micrófono o el oído (R-288).
 *
 * El navegador y el cliente de Whisper dan mensajes para quien programa
 * («NotAllowedError: Permission denied», «fallo al conectar a ws://…»). Aquí
 * se convierten en una frase que dice qué pasó y qué hacer, en la voz de
 * Shiro. Los casos que no se reconocen conservan el mensaje original, para
 * poder buscarlo.
 */

import { WhisperSttError, type SttFailureCode } from './whisper-stt-client.js';

const STT_TEXT: Record<SttFailureCode, string> = {
  connect:
    'No pude conectar con Whisper, que es quien me transcribe. Comprueba en Setup que está en marcha.',
  'connect-timeout':
    'Whisper no contesta, y es quien me transcribe. Comprueba en Setup que está en marcha.',
  'final-timeout':
    'Whisper no terminó de transcribir lo que dijiste. Inténtalo otra vez; si se repite, mira su estado en Setup.',
  closed: 'Se cortó la conexión con Whisper mientras te escuchaba. Inténtalo otra vez.',
  server: 'Whisper no pudo transcribir lo que dijiste. Inténtalo otra vez.',
};

/** Fallos de `getUserMedia`, por el `name` que les pone el navegador. */
const MIC_TEXT: Record<string, string> = {
  NotAllowedError:
    'No tengo permiso para usar el micrófono. Actívalo en Windows: Configuración, Privacidad y seguridad, Micrófono.',
  SecurityError:
    'No tengo permiso para usar el micrófono. Actívalo en Windows: Configuración, Privacidad y seguridad, Micrófono.',
  NotFoundError: 'No encuentro ningún micrófono. Conecta uno y vuelve a intentarlo.',
  OverconstrainedError: 'No encuentro ningún micrófono. Conecta uno y vuelve a intentarlo.',
  NotReadableError:
    'El micrófono no responde; puede que lo esté usando otra aplicación. Ciérrala y vuelve a intentarlo.',
  AbortError:
    'El micrófono no responde; puede que lo esté usando otra aplicación. Ciérrala y vuelve a intentarlo.',
};

/** Texto para un fallo de Whisper del que solo se conoce el tipo. */
export function describeSttFailure(code: SttFailureCode): string {
  return STT_TEXT[code];
}

/** Texto para cualquier fallo del turno de voz. */
export function describeMicError(err: unknown): string {
  if (err instanceof WhisperSttError) return describeSttFailure(err.code);
  if (err instanceof Error && Object.hasOwn(MIC_TEXT, err.name)) {
    return MIC_TEXT[err.name] ?? '';
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `No pude usar el micrófono: ${detail.replace(/\.+$/, '')}.`;
}
