/**
 * ThemeSwitcher — selector compacto para cambiar el tema visual.
 *
 * En PR B (este) vive flotando arriba del orb playground.
 * En PR C pasará al panel de Tweaks / Settings.
 */

import { useEffect } from 'react';
import { applyTheme, THEMES, THEME_LABELS, type ThemeName } from '../../themes';
import styles from './ThemeSwitcher.module.css';

export interface ThemeSwitcherProps {
  value: ThemeName;
  onChange: (next: ThemeName) => void;
}

export function ThemeSwitcher({ value, onChange }: ThemeSwitcherProps): JSX.Element {
  // Aplica el tema al body cada vez que cambia. El effect cubre el
  // mount inicial también — al primer render se aplica el tema por defecto.
  useEffect(() => {
    applyTheme(value);
  }, [value]);

  return (
    <div className={styles.wrap} role="radiogroup" aria-label="Tema visual">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={t === value}
          className={`${styles.option} ${t === value ? styles.active : ''}`}
          onClick={() => {
            onChange(t);
          }}
        >
          {THEME_LABELS[t]}
        </button>
      ))}
    </div>
  );
}
