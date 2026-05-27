/**
 * Hub del sistema de temas.
 *
 * Importa los CSS de los 3 temas (los registra) y exporta el tipo
 * `ThemeName` + utilidades para aplicarlos al body.
 *
 * Ver ADR 0008 (3 temas swap-eables en producción).
 */

// Side-effect imports: registran las reglas .theme-* en el documento.
import '@fontsource/quicksand/400.css';
import '@fontsource/quicksand/500.css';
import '@fontsource/quicksand/600.css';
import '@fontsource/quicksand/700.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

import './base.css';
import './kawaii.css';
import './cyber.css';
import './editorial.css';

export type ThemeName = 'kawaii' | 'cyber' | 'editorial';

export const THEMES: readonly ThemeName[] = ['kawaii', 'cyber', 'editorial'] as const;

/**
 * Etiquetas en español para mostrar en la UI del selector.
 */
export const THEME_LABELS: Record<ThemeName, string> = {
  kawaii: 'Kawaii pastel',
  cyber: 'Cyberpunk',
  editorial: 'Editorial',
};

/**
 * Aplica un tema al body via clase `theme-<name>`. Quita cualquier
 * clase previa de tema para evitar acumulación.
 *
 * Es la única función que toca el DOM globalmente; el resto del
 * sistema de temas pasa por React state.
 */
export function applyTheme(theme: ThemeName): void {
  const body = document.body;
  THEMES.forEach((t) => {
    body.classList.remove(`theme-${t}`);
  });
  body.classList.add(`theme-${theme}`);
}
