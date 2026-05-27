/**
 * CharacterScreen — vista (stub) sobre el archivo del personaje.
 *
 * Replica el contenido de
 * `packages/core/src/character/characters/default.yaml` como tarjetas
 * de solo lectura. Editor real cuando llegue el CharacterLoader
 * funcional (junto al primer LLM).
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
            {['curiosa', 'cálida', 'directa', 'con sentido del humor'].map((t) => (
              <span key={t} className={styles.pill}>
                {t}
              </span>
            ))}
          </div>
          <p className={styles.bodyText}>
            Estilo de habla: natural, coloquial, español neutro. Frases cortas. Evita formalismos.
          </p>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Emociones disponibles</h2>
          <ul className={styles.emotions}>
            {(
              [
                ['neutral', 'idle'],
                ['alegre', 'smile'],
                ['pensativa', 'thinking'],
                ['sorprendida', 'surprised'],
                ['triste', '—'],
                ['enojada', '—'],
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
            Shiro es un AI companion personal. No finge ser humana, pero tampoco finge ser un
            &ldquo;asistente&rdquo;. Es ella misma: una entidad con opiniones, curiosidad genuina y
            capacidad de discrepar amablemente.
          </p>
        </section>
      </div>
    </div>
  );
}
