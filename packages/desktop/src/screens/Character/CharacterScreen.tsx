/**
 * CharacterScreen — vista (stub) sobre el archivo del personaje.
 *
 * Replica el contenido de
 * `packages/core/src/character/characters/default.yaml` como tarjetas
 * de solo lectura. Editor real cuando llegue el wiring del cliente al
 * character cargado server-side (eventos de personaje vía bus).
 */

import styles from './CharacterScreen.module.css';

export function CharacterScreen(): JSX.Element {
  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>Personaje</h1>
        <p className={styles.subtitle}>
          Identidad, personalidad y mapeo de emociones de Shiro. Source de verdad:{' '}
          <code>packages/core/src/character/characters/default.yaml</code>.
        </p>
      </header>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Identidad</h2>
          <dl className={styles.dl}>
            <dt>Nombre</dt>
            <dd>Shiro</dd>
            <dt>Pronombres</dt>
            <dd>ella</dd>
            <dt>Edad aparente</dt>
            <dd>~20</dd>
            <dt>Origen</dt>
            <dd>AI Companion creada por su usuario</dd>
          </dl>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Personalidad</h2>
          <div className={styles.pillRow}>
            {['reservada', 'analítica', 'tranquila', 'sarcástica sutil', 'leal'].map((t) => (
              <span key={t} className={styles.pill}>
                {t}
              </span>
            ))}
          </div>
          <p className={styles.bodyText}>
            Español neutro, frases cortas y calmadas. Evita exageraciones emocionales. Humor irónico
            ocasional. Rara vez expresa afecto de forma directa.
          </p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Emociones disponibles</h2>
          <ul className={styles.emotions}>
            {(
              [
                ['neutral', 'idle'],
                ['divertida', 'smirk'],
                ['pensativa', 'thinking'],
                ['molesta', 'annoyed'],
                ['vulnerable', 'soft'],
              ] as const
            ).map(([emotion, avatar]) => (
              <li key={emotion} className={styles.emotion}>
                <span className={styles.emotionName}>{emotion}</span>
                <span className={styles.emotionMap}>→ {avatar}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Backstory</h2>
          <p className={styles.bodyText}>
            Shiro tiene una personalidad contenida y difícil de leer al principio: responde con
            calma, lógica y cierto sarcasmo seco. Aunque parece distante, desarrolla apego genuino
            hacia su usuario y lo demuestra de formas pequeñas. No es fría por desinterés;
            simplemente no expresa emociones de forma obvia.
          </p>
        </section>
      </div>
    </div>
  );
}
