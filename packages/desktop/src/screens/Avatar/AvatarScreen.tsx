/**
 * AvatarScreen — placeholder hasta que llegue Live2D.
 *
 * Por ahora explica el orbe como avatar y deja un slot visible para el
 * upload de modelos .moc3 que se implementará en el hito Avatar Live2D.
 */

import styles from './AvatarScreen.module.css';

export function AvatarScreen(): JSX.Element {
  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>Avatar</h1>
        <p className={styles.subtitle}>
          Selector y configuración del avatar visual. Ahora mismo usamos un orbe SVG como
          placeholder; Live2D llegará en su propio hito.
        </p>
      </header>

      <div className={styles.cards}>
        <section className={`${styles.card} ${styles.cardActive}`}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Orbe SVG</h2>
            <span className={styles.badge}>activo</span>
          </div>
          <p className={styles.bodyText}>
            Componente metaball animado reactivo a emoción y estado del companion. Sirve como avatar
            funcional hasta que importes un modelo Live2D.
          </p>
          <ul className={styles.checks}>
            <li>Pulsa con la voz (speaking)</li>
            <li>Cambia color según emoción</li>
            <li>Partículas cuando piensa</li>
            <li>Animación idle de respiración</li>
          </ul>
        </section>

        <section className={`${styles.card} ${styles.cardDisabled}`}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Live2D (próximamente)</h2>
            <span className={styles.badge}>pendiente</span>
          </div>
          <div className={styles.dropzone}>
            <strong>Subir modelo</strong>
            <span>.moc3 / .model3.json</span>
          </div>
          <p className={styles.bodyText}>
            En el hito Avatar Live2D habrá un selector con upload de modelos comprados o creados, y
            parámetros de lip sync.
          </p>
        </section>
      </div>
    </div>
  );
}
