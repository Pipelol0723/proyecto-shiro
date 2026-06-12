/**
 * AvatarScreen — pantalla full-screen del avatar.
 *
 * Tras el hito Avatar Live2D, esta pantalla pasa a ser un "view grande"
 * del avatar: muestra el Live2D (o el Orbe como fallback) en tamaño
 * cómodo + un panel de info al lado con el modelo activo y un placeholder
 * para el selector de modelos futuro.
 *
 * El destino final de esta pantalla (¿selector de modelos?, ¿settings
 * del avatar?, ¿se merge con ConversationScreen?) queda diferido para
 * verlo en uso — ver ADR 0021 "Lo que el usuario quiere dejar fuera
 * de V1".
 */

import { Avatar } from '../../components/Avatar';
import { useCompanion } from '../../state/use-companion';
import styles from './AvatarScreen.module.css';

export function AvatarScreen(): JSX.Element {
  const [state] = useCompanion();

  return (
    <div className={styles.screen}>
      <section className={styles.stage}>
        <Avatar
          emotion={state.emotion}
          speaking={state.speaking}
          listening={state.listening}
          thinking={state.thinking}
          size={420}
        />
      </section>

      <aside className={styles.sidebar}>
        <header className={styles.head}>
          <h1 className={styles.title}>Avatar</h1>
          <p className={styles.subtitle}>
            Vista ampliada del avatar. Live2D si está configurado, Orbe SVG como fallback
            automático.
          </p>
        </header>

        <section className={`${styles.card} ${styles.cardActive}`}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Live2D — Hiyori (placeholder)</h2>
            <span className={styles.badge}>activo</span>
          </div>
          <p className={styles.bodyText}>
            Modelo placeholder del Cubism SDK. Si los assets propietarios no están descargados, esta
            vista cae automáticamente al Orbe.
          </p>
          <ul className={styles.checks}>
            <li>Cambia expresión por emoción del LLM</li>
            <li>Lip-sync con el audio del TTS (próximo PR)</li>
            <li>Animación idle automática</li>
            <li>Cap de 30 fps para hardware actual</li>
          </ul>
        </section>

        <section className={`${styles.card} ${styles.cardDisabled}`}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Modelo definitivo</h2>
            <span className={styles.badge}>pendiente</span>
          </div>
          <p className={styles.bodyText}>
            El modelo final de Shiro se elegirá tras probar el placeholder. El upload / swap de
            modelos vendrá en su propio hito.
          </p>
        </section>
      </aside>
    </div>
  );
}
