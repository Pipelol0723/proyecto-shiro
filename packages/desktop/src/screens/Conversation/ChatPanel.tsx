/**
 * ChatPanel — historial de conversación colapsable.
 *
 * Lateral derecho. Lista los mensajes (user + shiro) con un chip
 * indicando tier/latencia/emoción si están disponibles.
 */

import type { CompanionMessage } from '../../state/companion-reducer';
import styles from './ChatPanel.module.css';

export interface ChatPanelProps {
  history: readonly CompanionMessage[];
  open: boolean;
  onToggle: () => void;
}

export function ChatPanel({ history, open, onToggle }: ChatPanelProps): JSX.Element {
  return (
    <aside
      className={`${styles.panel} ${open ? styles.open : styles.closed}`}
      aria-label="Historial"
    >
      <button type="button" className={styles.toggle} onClick={onToggle} aria-expanded={open}>
        {open ? 'Cerrar chat' : 'Abrir chat'}
        <span className={styles.count}>{history.length}</span>
      </button>
      {open && (
        <ol className={styles.list}>
          {history.length === 0 && (
            <li className={styles.empty}>Aún no hay mensajes. Probá hablar o escribir.</li>
          )}
          {history.map((msg, i) => (
            <li
              // Histórico es append-only; índice es suficiente como key.
              key={`${msg.timestamp}-${String(i)}`}
              className={`${styles.msg} ${msg.role === 'user' ? styles.user : styles.shiro}`}
            >
              <div className={styles.head}>
                <span className={styles.role}>{msg.role === 'user' ? 'Tú' : 'Shiro'}</span>
                {msg.tier && <span className={styles.tag}>{msg.tier}</span>}
                {msg.latencyMs !== undefined && (
                  <span className={styles.tag}>{msg.latencyMs}ms</span>
                )}
                {msg.emotion && msg.role === 'shiro' && (
                  <span className={styles.tag}>{msg.emotion}</span>
                )}
              </div>
              <div className={styles.body}>{msg.text}</div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
