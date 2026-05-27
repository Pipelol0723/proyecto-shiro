/**
 * App — playground del orbe (PR B del cliente desktop).
 *
 * Renderiza el orbe en el centro con controles para forzar emoción y
 * estados (speaking / listening / thinking) + selector de tema.
 *
 * Esta UI es temporal — sirve para validar el orbe + temas. En PR C
 * se reemplaza por el layout real (sidebar + header + screens) y los
 * controles desaparecen porque el state vendrá del EventBus.
 */

import { useState } from 'react';
import { Orb } from './components/Orb';
import type { Emotion } from './components/Orb';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import type { ThemeName } from './themes';
import styles from './App.module.css';

const EMOTIONS: readonly Emotion[] = [
  'neutral',
  'alegre',
  'pensativa',
  'sorprendida',
  'triste',
  'enojada',
] as const;

const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: 'Neutral',
  alegre: 'Alegre',
  pensativa: 'Pensativa',
  sorprendida: 'Sorprendida',
  triste: 'Triste',
  enojada: 'Enojada',
};

export function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeName>('kawaii');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);

  return (
    <main className={styles.playground}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Shiro</h1>
          <p className={styles.subtitle}>playground del orbe · PR B</p>
        </div>
        <ThemeSwitcher value={theme} onChange={setTheme} />
      </header>

      <section className={styles.stage}>
        <Orb
          emotion={emotion}
          speaking={speaking}
          listening={listening}
          thinking={thinking}
          size={320}
        />
      </section>

      <footer className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Emoción</span>
          <div className={styles.pillRow} role="radiogroup" aria-label="Emoción">
            {EMOTIONS.map((e) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={emotion === e}
                className={`${styles.pill} ${emotion === e ? styles.pillActive : ''}`}
                onClick={() => {
                  setEmotion(e);
                }}
              >
                {EMOTION_LABELS[e]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Estado</span>
          <div className={styles.pillRow}>
            <button
              type="button"
              aria-pressed={speaking}
              className={`${styles.pill} ${speaking ? styles.pillActive : ''}`}
              onClick={() => {
                setSpeaking((v) => !v);
              }}
            >
              speaking
            </button>
            <button
              type="button"
              aria-pressed={listening}
              className={`${styles.pill} ${listening ? styles.pillActive : ''}`}
              onClick={() => {
                setListening((v) => !v);
              }}
            >
              listening
            </button>
            <button
              type="button"
              aria-pressed={thinking}
              className={`${styles.pill} ${thinking ? styles.pillActive : ''}`}
              onClick={() => {
                setThinking((v) => !v);
              }}
            >
              thinking
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
