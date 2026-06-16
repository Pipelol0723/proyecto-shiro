/**
 * App — layout final del cliente desktop.
 *
 * `BusProvider` envuelve todo; dentro, `CompanionProvider` monta el state
 * del companion **una sola vez**, por encima del switch de pantallas. Eso
 * es clave: el historial de chat y la suscripción a `memory:snapshot` viven
 * en el provider, no en `ConversationScreen`, así que la conversación
 * **sobrevive a los cambios de pantalla** (antes se perdía al navegar —
 * ver `state/companion-context.tsx`). El `Sidebar` elige pantalla y el
 * `Header` muestra título + tema. Las 5 pantallas conviven; solo se
 * renderiza la activa.
 *
 * El `bus` se inyecta desde `main.tsx` (producción) con
 * `WebSocketTransport` al server. Si se omite (tests, demos), el
 * `BusProvider` cae al default `InProcessTransport`.
 */

import { useState } from 'react';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import { BusProvider } from './bus-context';
import { CompanionProvider } from './state/companion-context';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar, Header, type ScreenId } from './layout';
import {
  ConversationScreen,
  ModulesScreen,
  CharacterScreen,
  AvatarScreen,
  SetupScreen,
} from './screens';
import type { ThemeName } from './themes';
import { UpdateBanner } from './updater/UpdateBanner';
import { ToolApprovalModal } from './components/ToolApproval';
import styles from './App.module.css';

export interface AppProps {
  /** Bus de producción inyectado desde `main.tsx`. Omitir en tests. */
  bus?: IEventBus<EventMap>;
}

export function App({ bus }: AppProps = {}): JSX.Element {
  return (
    <BusProvider bus={bus}>
      <CompanionProvider>
        {/* Red de seguridad: si algo en el árbol lanza al renderizar, antes
            se llevaba TODA la app a blanco. Ahora el boundary muestra el
            error (diagnosticable) en vez de una pantalla muerta. El Avatar
            tiene además su propio boundary que cae al Orbe sin molestar. */}
        <ErrorBoundary fallback={(error) => <AppCrashFallback error={error} />}>
          <AppShell />
        </ErrorBoundary>
      </CompanionProvider>
    </BusProvider>
  );
}

/** Fallback de último recurso cuando algo del árbol crashea al renderizar. */
function AppCrashFallback({ error }: { error: Error }): JSX.Element {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        height: '100vh',
        padding: 24,
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20 }}>Algo se rompió en la interfaz</h1>
      <p style={{ margin: 0, opacity: 0.7, maxWidth: 480 }}>
        Shiro encontró un error inesperado al renderizar. El detalle de abajo ayuda a
        diagnosticarlo.
      </p>
      <pre
        style={{
          maxWidth: 560,
          overflow: 'auto',
          padding: 12,
          borderRadius: 8,
          background: 'rgba(0,0,0,0.06)',
          fontSize: 12,
        }}
      >
        {error.message}
      </pre>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        style={{ padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}
      >
        Recargar
      </button>
    </div>
  );
}

/**
 * Shell de UI: vive dentro de `CompanionProvider`, mantiene el tema y la
 * pantalla activa, y renderiza el layout. Estado puramente de UI — el state
 * del companion lo lee cada pantalla con `useCompanion()`.
 */
function AppShell(): JSX.Element {
  const [theme, setTheme] = useState<ThemeName>('kawaii');
  const [screen, setScreen] = useState<ScreenId>('chat');

  return (
    <div className={styles.app}>
      {/* Aviso de auto-update (ADR 0024 §4). Invisible fuera de Tauri
          y cuando la app está al día. */}
      <UpdateBanner />
      {/* Modal de aprobación de tools agénticas confirm (ADR 0022 §4).
          Invisible salvo cuando Shiro pide permiso para una acción. */}
      <ToolApprovalModal />
      <Sidebar active={screen} onChange={setScreen} />
      <main className={styles.main}>
        <Header screen={screen} theme={theme} onThemeChange={setTheme} />
        <div className={styles.content}>
          {screen === 'chat' && <ConversationScreen />}
          {screen === 'modules' && <ModulesScreen />}
          {screen === 'character' && <CharacterScreen />}
          {screen === 'avatar' && <AvatarScreen />}
          {screen === 'setup' && <SetupScreen />}
        </div>
      </main>
    </div>
  );
}
