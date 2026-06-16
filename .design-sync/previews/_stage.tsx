/**
 * Stage — wrapper de preview compartido por las cards de Shiro UI Kit.
 *
 * Aplica una clase de tema (`theme-kawaii` | `theme-cyber` | `theme-editorial`)
 * para que las variables de color/fuente de la marca queden definidas en el
 * subárbol — sin esto el Orb sale negro y los iconos sin color de marca.
 *
 * No es un componente del DS: es andamiaje de composición para las previews.
 */
import * as React from 'react';

export type ThemeName = 'kawaii' | 'cyber' | 'editorial';

export function Stage({
  theme = 'kawaii',
  children,
  padding = 28,
  gap = 22,
}: {
  theme?: ThemeName;
  children: React.ReactNode;
  padding?: number;
  gap?: number;
}): JSX.Element {
  return (
    <div
      className={`theme-${theme}`}
      style={{
        padding,
        gap,
        background: 'var(--bg)',
        backgroundImage: 'var(--bg-grad)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 140,
        borderRadius: 16,
      }}
    >
      {children}
    </div>
  );
}
