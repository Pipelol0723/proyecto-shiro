/**
 * Tipos compartidos del layout (sidebar, header, screen routing).
 */

export type ScreenId = 'chat' | 'modules' | 'character' | 'avatar' | 'setup';

export interface ScreenDef {
  id: ScreenId;
  label: string;
}

export const SCREENS: readonly ScreenDef[] = [
  { id: 'chat', label: 'Conversación' },
  { id: 'modules', label: 'Módulos' },
  { id: 'character', label: 'Personaje' },
  { id: 'avatar', label: 'Avatar' },
  { id: 'setup', label: 'Setup' },
] as const;
