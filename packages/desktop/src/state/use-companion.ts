/**
 * Hook de acceso al state del companion desde componentes React.
 *
 * Separado de `companion-context.tsx` para que Fast Refresh de Vite no se
 * queje de mezcla de componentes y no-componentes en el mismo archivo
 * (mismo patrón que `bus-context.tsx` + `use-bus.ts`).
 */

import { useContext } from 'react';
import { CompanionContext, type CompanionContextValue } from './companion-context';

/**
 * Lee el `[state, dispatch]` del companion. Lanza si se usa fuera de
 * `<CompanionProvider>` (que App monta en el root) — así un olvido salta
 * en desarrollo en vez de silenciarse.
 */
export function useCompanion(): CompanionContextValue {
  const ctx = useContext(CompanionContext);
  if (ctx === null) {
    throw new Error('useCompanion() debe usarse dentro de <CompanionProvider>.');
  }
  return ctx;
}
