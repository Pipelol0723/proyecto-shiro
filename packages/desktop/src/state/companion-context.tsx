/**
 * CompanionProvider — eleva el state del companion al root de la app, por
 * encima del switch de pantallas.
 *
 * **El bug que arregla**: antes `useCompanionState` se llamaba dentro de
 * cada pantalla (ConversationScreen, AvatarScreen). Eso ataba el reducer —
 * y con él TODO el historial de chat y la suscripción a `memory:snapshot` —
 * al ciclo de vida de la pantalla. Al cambiar de pantalla, React desmontaba
 * el screen, el `useReducer` se destruía y el historial se perdía; al
 * volver, un reducer nuevo arrancaba vacío y, como el WebSocket no se
 * reconecta al navegar, nadie reemitía el snapshot. Resultado: la
 * conversación "desaparecía" al cambiar de opción.
 *
 * Montando el hook **una vez** aquí (dentro de `BusProvider`, fuera del
 * switch de pantallas) el state vive lo que vive la app: sobrevive a los
 * cambios de pantalla, y la suscripción a `memory:snapshot` está siempre
 * activa, así que la rehidratación al recargar es fiable. Bonus: las
 * distintas pantallas (chat, avatar) comparten un único state en vez de
 * mantener cada una su reducer aislado.
 *
 * Por convención de Fast Refresh (Vite) un archivo solo exporta
 * componentes; el hook `useCompanion` vive en `./use-companion.ts`.
 */

import { createContext, type Dispatch, type ReactNode } from 'react';
import type { CompanionAction, CompanionState } from './companion-reducer';
import { useCompanionState } from './useCompanionState';

export type CompanionContextValue = [CompanionState, Dispatch<CompanionAction>];

// El context se exporta para que `./use-companion.ts` lo consuma. Nadie más
// debería importarlo directamente — use `useCompanion()`.
// eslint-disable-next-line react-refresh/only-export-components -- el context vive con su Provider por simplicidad; el coste es perder HMR fino solo de este archivo, que cambia raramente.
export const CompanionContext = createContext<CompanionContextValue | null>(null);

export function CompanionProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useCompanionState();
  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}
