/**
 * ConversationScreen — pantalla principal del cliente.
 *
 * Coordina:
 *   - El orbe (avatar placeholder) — reactivo al state del companion.
 *   - Subtítulos en vivo (sttLive cuando el usuario habla, subtitle
 *     cuando Shiro habla).
 *   - Input de texto para enviar mensajes manualmente → emite
 *     `user:message` al bus.
 *   - Botón demo (icono micrófono) que emite un mensaje canned para
 *     probar el ciclo sin teclear.
 *   - ChatPanel lateral con historial.
 *
 * Toda la lógica del turno (router/llm/tts) vive server-side desde
 * ADR 0012 — el cliente solo emite `user:message` y consume los
 * eventos que el server emite de vuelta.
 */

import { useState } from 'react';
import { Orb } from '../../components/Orb';
import { IconMic, IconSend } from '../../components/Icons';
import { useBus } from '../../use-bus';
import { useCompanionState } from '../../state/useCompanionState';
import { ChatPanel } from './ChatPanel';
import styles from './ConversationScreen.module.css';

const LOCAL_USER_ID = 'me';

/** Mensaje canned que dispara el botón del micrófono (placeholder de STT real). */
const DEMO_MESSAGE = 'Hola Shiro, ¿cómo estás?';

export function ConversationScreen(): JSX.Element {
  const bus = useBus();
  const [state] = useCompanionState();
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(true);

  const sending = state.listening || state.thinking || state.speaking;

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

        <form className={styles.inputDock} onSubmit={onSubmitText}>
          <button
            type="button"
            className={styles.iconBtn}
            disabled={sending}
            onClick={() => void sendMessage(DEMO_MESSAGE)}
            title="Enviar mensaje de prueba"
            aria-label="Enviar mensaje de prueba"
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
