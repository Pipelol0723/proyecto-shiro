/**
 * ConversationScreen — pantalla principal del cliente.
 *
 * Coordina:
 *   - El orbe (avatar placeholder) — reactivo al state del companion.
 *   - Subtítulos en vivo (sttLive cuando el usuario habla, subtitle
 *     cuando Shiro habla).
 *   - Input de texto para enviar mensajes manualmente.
 *   - Botón demo que dispara el sample flow simulado.
 *   - ChatPanel lateral con historial.
 *
 * En PR C todos los datos vienen del reducer alimentado por eventos
 * simulados. Cuando lleguen los módulos reales (LLM, STT, TTS) los
 * eventos serán reales y esta pantalla no cambia.
 */

import { useState } from 'react';
import { Orb } from '../../components/Orb';
import { IconMic, IconSend } from '../../components/Icons';
import { useBus } from '../../use-bus';
import { useCompanionState } from '../../state/useCompanionState';
import { ChatPanel } from './ChatPanel';
import { runSampleFlow } from './sample-flow';
import styles from './ConversationScreen.module.css';

const LOCAL_USER_ID = 'me';

export function ConversationScreen(): JSX.Element {
  const bus = useBus();
  const [state] = useCompanionState();
  const [draft, setDraft] = useState('');
  const [chatOpen, setChatOpen] = useState(true);
  const [running, setRunning] = useState(false);

  async function runFlow(userInput?: string): Promise<void> {
    if (running) return;
    setRunning(true);
    try {
      await runSampleFlow({ bus, userId: LOCAL_USER_ID, userInput });
    } finally {
      setRunning(false);
    }
  }

  function onSubmitText(e: React.FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text || running) return;
    setDraft('');
    void runFlow(text);
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
            disabled={running}
            onClick={() => void runFlow()}
            title="Probar flujo simulado"
            aria-label="Probar flujo simulado"
          >
            <IconMic />
          </button>
          <input
            type="text"
            className={styles.input}
            placeholder="Escribe a Shiro…"
            value={draft}
            disabled={running}
            onChange={(e) => {
              setDraft(e.currentTarget.value);
            }}
          />
          <button
            type="submit"
            className={`${styles.iconBtn} ${styles.send}`}
            disabled={running || !draft.trim()}
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
