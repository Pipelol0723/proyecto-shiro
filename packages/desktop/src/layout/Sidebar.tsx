/**
 * Sidebar — navegación principal entre las 5 pantallas.
 *
 * Componente "dumb": recibe la pantalla activa y un callback de cambio.
 * No conoce el bus ni el state del companion.
 */

import { IconChat, IconModules, IconCharacter, IconAvatar, IconSetup } from '../components/Icons';
import { SCREENS, type ScreenId } from './types';
import styles from './Sidebar.module.css';

const ICONS: Record<ScreenId, () => JSX.Element> = {
  chat: () => <IconChat />,
  modules: () => <IconModules />,
  character: () => <IconCharacter />,
  avatar: () => <IconAvatar />,
  setup: () => <IconSetup />,
};

export interface SidebarProps {
  active: ScreenId;
  onChange: (next: ScreenId) => void;
}

export function Sidebar({ active, onChange }: SidebarProps): JSX.Element {
  return (
    <nav className={styles.sidebar} aria-label="Pantallas">
      <div className={styles.logo} aria-hidden="true" />
      {SCREENS.map((s) => {
        const Icon = ICONS[s.id];
        return (
          <button
            key={s.id}
            type="button"
            className={`${styles.item} ${active === s.id ? styles.active : ''}`}
            aria-current={active === s.id ? 'page' : undefined}
            title={s.label}
            onClick={() => {
              onChange(s.id);
            }}
          >
            <Icon />
            <span className={styles.label}>{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
