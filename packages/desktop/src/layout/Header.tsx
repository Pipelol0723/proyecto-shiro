/**
 * Header — barra superior con título de la pantalla activa + selector
 * de tema. Pantallas pueden inyectar children para añadir controles
 * propios (chips de status, botones de tweaks, etc.).
 */

import type { ReactNode } from 'react';
import { SCREENS, type ScreenId } from './types';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import type { ThemeName } from '../themes';
import styles from './Header.module.css';

export interface HeaderProps {
  screen: ScreenId;
  theme: ThemeName;
  onThemeChange: (next: ThemeName) => void;
  children?: ReactNode;
}

export function Header({ screen, theme, onThemeChange, children }: HeaderProps): JSX.Element {
  const screenDef = SCREENS.find((s) => s.id === screen);

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.title}>Shiro</span>
        <span className={styles.sep}>/</span>
        <span className={styles.screen}>{screenDef?.label ?? screen}</span>
      </div>
      <div className={styles.tools}>
        {children}
        <ThemeSwitcher value={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}
