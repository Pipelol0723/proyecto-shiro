/**
 * UpdateBanner — aviso flotante de actualización disponible.
 *
 * Se monta una vez en el root (App). No renderiza nada salvo cuando hay
 * una versión nueva o una descarga en curso/fallida. Fuera de Tauri
 * (`unsupported`) y al día (`none`) es invisible.
 */

import { useAppUpdater } from './useAppUpdater';
import styles from './UpdateBanner.module.css';

export function UpdateBanner(): JSX.Element | null {
  const { phase, update, install, dismiss } = useAppUpdater();

  if (phase === 'available' && update !== null) {
    return (
      <div className={styles.banner} role="status">
        <span className={styles.text}>
          Nueva versión <strong>v{update.version}</strong> disponible.
        </span>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={install}>
            Actualizar y reiniciar
          </button>
          <button type="button" className={styles.secondary} onClick={dismiss}>
            Después
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'downloading') {
    return (
      <div className={styles.banner} role="status">
        <span className={styles.text}>
          Descargando actualización… la app se reiniciará al terminar.
        </span>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
        <span className={styles.text}>No se pudo actualizar. Reintenta más tarde.</span>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={dismiss}>
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  // unsupported | checking | none → sin UI.
  return null;
}
