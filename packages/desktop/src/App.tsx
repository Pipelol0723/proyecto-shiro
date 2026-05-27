/**
 * App — componente raiz del cliente desktop.
 *
 * Estado actual (PR de setup): pantalla de bienvenida minima que
 * solo valida que Vite + React + TS + CSS Modules empaquetan bien.
 *
 * NOTA: NO importa nada de @proyecto-shiro/core en este PR. El barrel
 * de core re-exporta `ConfigLoader` que usa `node:fs`, lo cual Vite no
 * puede empaquetar para navegador. Antes de PR C (wiring) hay que
 * partir el core en dos entries (browser-safe vs Node-only) — se
 * documentara con un ADR nuevo.
 *
 * En PRs siguientes se reemplaza por:
 * - Sidebar + Header + main content (PR B - orbe + temas)
 * - 5 screens completas + wiring real al core (PR C)
 */

import styles from './App.module.css';

export function App(): JSX.Element {
  return (
    <main className={styles.welcome}>
      <h1 className={styles.title}>Shiro</h1>
      <p className={styles.subtitle}>AI Companion modular</p>
      <p className={styles.versions}>
        cliente desktop <code>0.1.0</code>
      </p>
      <p className={styles.hint}>
        Esta pantalla es temporal. El orbe + las pantallas reales llegan en los siguientes PRs.
      </p>
    </main>
  );
}
