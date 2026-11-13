/**
 * ConversationScreen — pantalla principal del cliente.
 *
 * Coordina:
 *   - El orbe (avatar placeholder) — reactivo al state del companion.
 *   - Subtítulos en vivo (sttLive cuando el usuario habla, subtitle
 *     cuando Shiro habla).
 *   - Input de texto para enviar mensajes manualmente → emite
 *     `user:message` al bus.
 *   - Botón de micro real (push-to-talk) que captura audio del micro,
 *     lo manda al microservicio Whisper por WS y publica los eventos
 *     `stt:listening` / `stt:partial` / `stt:transcribed` al bus.
 *     También responde a `Space` (mientras el foco no esté en el input).
 *   - ChatPanel lateral con historial.
 *
 * Toda la lógica del turno (router/llm/tts) vive server-side desde
 * ADR 0012 — el cliente solo emite `user:message` y consume los
 * eventos que el server emite de vuelta.
 *
 * NOTA: la traducción `stt:transcribed` → `user:message` (para arrancar
 * el pipeline conversacional cuando el usuario habla) llega en un PR
 * aparte (PR #13 del hito STT). En este PR el botón ya captura y los
 * eventos `stt:*` se publican; falta el último wire.
 */

import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { IconMic, IconSend } from '../../components/Icons';
import { useBus } from '../../use-bus';
import { useConnectionState } from '../../connection/use-connection';
import { useCompanion } from '../../state/use-companion';
import { useMicrophonePTT } from '../../audio/useMicrophonePTT';
import { useAudio } from '../../audio/use-audio';
import { ChatPanel } from './ChatPanel';
import styles from './ConversationScreen.module.css';

const LOCAL_USER_ID = 'me';
const DEFAULT_AVATAR_SIZE = 560;
const MIN_AVATAR_SIZE = 360;
const MAX_AVATAR_SIZE = 720;

function clampAvatarSize(size: number): number {
  return Math.min(MAX_AVATAR_SIZE, Math.max(MIN_AVATAR_SIZE, Math.floor(size)));
}

export function ConversationScreen(): JSX.Element {
  const bus = useBus();
  const [state, dispatch] = useCompanion();
  // Sin conexión abierta no se puede escribir ni hablar (P-07a, R-068).
  const connected = useConnectionState() === 'open';
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(true);
  const stageRef = useRef<HTMLElement | null>(null);
  const [avatarSize, setAvatarSize] = useState(DEFAULT_AVATAR_SIZE);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;

    const updateAvatarSize = (): void => {
      const { width, height } = stage.getBoundingClientRect();
      const nextSize = clampAvatarSize(Math.min(width * 0.56, height - 260));
      setAvatarSize((current) => (current === nextSize ? current : nextSize));
    };

    updateAvatarSize();
    const resizeObserver = new ResizeObserver(updateAvatarSize);
    resizeObserver.observe(stage);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // El audio TTS lo reproduce `AudioProvider` (global, sobrevive al cambio
  // de pantalla). Mute persistido en localStorage por cliente (ver ADR
  // 0020) — el toggle de la UI cambia esta preferencia.
  const ttsPlayback = useAudio();

  // Mientras el LLM piensa, bloqueamos input. Mientras Shiro habla
  // (speaking) SÍ permitimos input — pero antes emitimos `tts:cancel`
  // para cortar el audio actual (ADR 0020 decisión 4: cancelable
  // mid-speech). Sin esta distinción el usuario no podría corregir
  // hasta que la frase obsoleta terminara.
  const thinking = state.thinking;
  const sending = thinking; // alias semántico para los disables
  const ptt = useMicrophonePTT({ bus, userId: LOCAL_USER_ID, enabled: !thinking && connected });
  const micActive = ptt.state === 'recording' || ptt.state === 'requesting';
  const micDisabled = ptt.state === 'unsupported' || thinking || !connected;

  // Si se pierde la conexión con la captura en curso, `enabled` desmonta los
  // listeners de teclado (se pierde el keyup) y el botón queda deshabilitado
  // (se pierde el pointerup): hay que parar el micro explícitamente.
  // Se cancela (no `stop`): parar pediría la transcripción a Whisper y se
  // emitiría un `stt:transcribed` local que el servidor nunca recibiría.
  const { state: pttState, cancel: pttCancel } = ptt;
  useEffect(() => {
    if (!connected && pttState === 'recording') pttCancel();
  }, [connected, pttState, pttCancel]);

  // Tras una pérdida de conexión `speaking` se apaga, pero un audio ya recibido
  // puede seguir sonando: se corta también si el elemento suena de verdad.
  const audioIsPlaying =
    state.speaking || (ttsPlayback.audioElement !== null && !ttsPlayback.audioElement.paused);

  // Si el micro falla tras `stt:listening` (permiso denegado, sin dispositivo),
  // nadie emitiría `stt:transcribed` y «Escuchando…» quedaría fijo (R-118).
  useEffect(() => {
    if (ptt.state === 'error' && state.listening) dispatch({ type: 'LISTEN_END' });
  }, [ptt.state, state.listening, dispatch]);

  async function sendMessage(text: string): Promise<void> {
    if (!connected || thinking || !text.trim()) return;
    if (audioIsPlaying) ttsPlayback.cancel();
    await bus.emit('user:message', { text: text.trim(), userId: LOCAL_USER_ID });
  }

  function onSubmitText(e: React.FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || !connected) return;
    setDraft('');
    void sendMessage(text);
  }

  // Click-and-hold como alternativa al teclado: pulsar el botón inicia
  // captura; soltar (o salir) la termina. Para accesibilidad básica,
  // un toggle con click rápido también funciona.
  function onMicPointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
    if (micDisabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Si Shiro está hablando, interrumpir antes de empezar a capturar
    // (cancelable mid-speech, ADR 0020 decisión 4).
    if (audioIsPlaying) ttsPlayback.cancel();
    void ptt.start();
  }
  function onMicPointerUp(): void {
    if (ptt.state === 'recording') void ptt.stop();
  }

  const micTitle = (() => {
    if (ptt.state === 'unsupported') return 'Tu navegador no soporta captura de audio';
    if (!connected) return 'Sin conexión con Shiro';
    if (sending) return 'Espera a que termine el turno actual';
    if (micActive) return 'Soltando para terminar…';
    if (state.speaking) return 'Interrumpir y hablar';
    return 'Mantén pulsado (o Space) para hablar';
  })();

  const muteTitle = ttsPlayback.muted
    ? 'Audio silenciado en este dispositivo — click para activar'
    : 'Audio activo — click para silenciar';

  return (
    <div className={styles.screen}>
      <section ref={stageRef} className={styles.stage}>
        <Avatar
          emotion={state.emotion}
          speaking={state.speaking}
          listening={state.listening}
          thinking={state.thinking}
          size={avatarSize}
          audioElement={ttsPlayback.audioElement}
        />

        <div className={styles.statusBar}>
          {state.listening && <span className={styles.status}>Escuchando…</span>}
          {state.thinking && (
            <span className={styles.status}>
              Pensando con {state.routedTo === 'cloud' ? 'Claude' : 'Qwen'}…
            </span>
          )}
          {state.speaking && <span className={styles.status}>Hablando…</span>}
          <span className={styles.status} title="Emoción de la última respuesta de Shiro">
            🎭 {state.emotion}
          </span>
          <button
            type="button"
            className={styles.muteToggle}
            onClick={() => {
              ttsPlayback.setMuted(!ttsPlayback.muted);
            }}
            title={muteTitle}
            aria-label={muteTitle}
            aria-pressed={ttsPlayback.muted}
          >
            {ttsPlayback.muted ? 'audio off' : 'audio on'}
          </button>
        </div>

        {/* Subtítulos / transcripción en vivo */}
        <div className={styles.captionBox}>
          {state.sttLive && <p className={styles.userCaption}>{state.sttLive}</p>}
          {state.subtitle && <p className={styles.shiroCaption}>{state.subtitle}</p>}
        </div>

        {ptt.state === 'error' && ptt.error !== null && (
          <p className={styles.micError} role="alert">
            Micro: {ptt.error}
          </p>
        )}

        <form className={styles.inputDock} onSubmit={onSubmitText}>
          <button
            type="button"
            className={`${styles.iconBtn} ${micActive ? styles.micRecording : ''}`}
            disabled={micDisabled}
            onPointerDown={onMicPointerDown}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerUp}
            onPointerLeave={onMicPointerUp}
            title={micTitle}
            aria-label={micTitle}
            aria-pressed={micActive}
          >
            <IconMic />
          </button>
          <input
            type="text"
            className={styles.input}
            placeholder={connected ? 'Escribe a Shiro…' : 'Sin conexión con Shiro…'}
            value={draft}
            disabled={sending || !connected}
            onChange={(e) => {
              setDraft(e.currentTarget.value);
            }}
          />
          <button
            type="submit"
            className={`${styles.iconBtn} ${styles.send}`}
            disabled={sending || !connected || !draft.trim()}
            aria-label="Enviar"
          >
            <IconSend />
          </button>
        </form>
      </section>

      <ChatPanel
        history={state.history}
        open={chatOpen}
        onToggle={() => {
          setChatOpen((v) => !v);
        }}
      />
    </div>
  );
}
