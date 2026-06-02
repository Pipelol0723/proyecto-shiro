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

import { useState } from 'react';
import { Orb } from '../../components/Orb';
import { IconMic, IconSend } from '../../components/Icons';
import { useBus } from '../../use-bus';
import { useCompanionState } from '../../state/useCompanionState';
import { useMicrophonePTT } from '../../audio/useMicrophonePTT';
import { ChatPanel } from './ChatPanel';
import styles from './ConversationScreen.module.css';

const LOCAL_USER_ID = 'me';

export function ConversationScreen(): JSX.Element {
  const bus = useBus();
  const [state] = useCompanionState();
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(true);

  const ptt = useMicrophonePTT({ bus, userId: LOCAL_USER_ID });
  const micActive = ptt.state === 'recording' || ptt.state === 'requesting';
  // Mientras hay turno en vuelo (texto o voz) no aceptamos nuevo input.
  const sending = state.thinking || state.speaking;
  // El botón de micro se deshabilita en `unsupported` (no hay API en este
  // browser) o si hay un turno en vuelo (no podemos hablar y procesar a la vez).
  const micDisabled = ptt.state === 'unsupported' || sending;

  async function sendMessage(text: string): Promise<void> {
    if (sending || !text.trim()) return;
    await bus.emit('user:message', { text: text.trim(), userId: LOCAL_USER_ID });
  }

  function onSubmitText(e: React.FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
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
    void ptt.start();
  }
  function onMicPointerUp(): void {
    if (ptt.state === 'recording') void ptt.stop();
  }

  const micTitle = (() => {
    if (ptt.state === 'unsupported') return 'Tu navegador no soporta captura de audio';
    if (sending) return 'Espera a que termine el turno actual';
    if (micActive) return 'Soltando para terminar…';
    return 'Mantén pulsado (o Space) para hablar';
  })();

  return (
    <div className={styles.screen}>
      <section className={styles.stage}>
        <Orb
          emotion={state.emotion}
          speaking={state.speaking}
          listening={state.listening}
          thinking={state.thinking}
          size={300}
        />

        <div className={styles.statusBar}>
          {state.listening && <span className={styles.status}>Escuchando…</span>}
          {state.thinking && (
            <span className={styles.status}>
              Pensando con {state.routedTo === 'cloud' ? 'Claude' : 'Qwen'}…
            </span>
          )}
          {state.speaking && <span className={styles.status}>Hablando…</span>}
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
            placeholder="Escribe a Shiro…"
            value={draft}
            disabled={sending}
            onChange={(e) => {
              setDraft(e.currentTarget.value);
            }}
          />
          <button
            type="submit"
            className={`${styles.iconBtn} ${styles.send}`}
            disabled={sending || !draft.trim()}
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
