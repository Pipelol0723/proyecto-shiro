/**
 * useAppUpdater — comprueba si hay una versión nueva del binario y, si el
 * usuario acepta, la descarga, instala y reinicia la app (ADR 0024 §4).
 *
 * Usa `@tauri-apps/plugin-updater` (que consulta el feed firmado de
 * GitHub Releases) + `@tauri-apps/plugin-process` para el relaunch.
 *
 * **No-op fuera de Tauri**: en `npm run dev` (navegador puro) no hay
 * runtime de Tauri, así que el hook detecta el entorno y se queda en
 * fase `unsupported` sin importar los módulos del plugin (los `import()`
 * son dinámicos y solo se evalúan dentro del binario). Así el bundle web
 * nunca toca APIs nativas.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';

/** Detecta si corremos dentro del WebView de Tauri (v2). */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type UpdaterPhase =
  | 'unsupported' // no estamos en Tauri (dev web)
  | 'checking' // consultando el feed
  | 'none' // al día, no hay update
  | 'available' // hay update, esperando decisión del usuario
  | 'downloading' // descargando/instalando
  | 'error'; // falló el check o la instalación

export interface AvailableUpdate {
  version: string;
  notes: string | undefined;
}

export interface UseAppUpdaterResult {
  phase: UpdaterPhase;
  update: AvailableUpdate | null;
  /** Descarga, instala y reinicia. Solo válido en fase `available`. */
  install: () => void;
  /** Oculta el aviso de esta sesión (no vuelve a molestar hasta reabrir). */
  dismiss: () => void;
}

export function useAppUpdater(): UseAppUpdaterResult {
  const [phase, setPhase] = useState<UpdaterPhase>(isTauri() ? 'checking' : 'unsupported');
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const found = await check();
        if (cancelled) return;
        if (found === null) {
          setPhase('none');
          return;
        }
        updateRef.current = found;
        setUpdate({ version: found.version, notes: found.body ?? undefined });
        setPhase('available');
      } catch {
        if (cancelled) return;
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(() => {
    const found = updateRef.current;
    if (found === null) return;
    setPhase('downloading');
    void (async () => {
      try {
        await found.downloadAndInstall();
        // Reinicia para arrancar en la versión nueva. `relaunch` no
        // retorna (el proceso se reemplaza); el catch cubre el caso raro.
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      } catch {
        setPhase('error');
      }
    })();
  }, []);

  const dismiss = useCallback(() => {
    setPhase('none');
  }, []);

  return { phase, update, install, dismiss };
}
