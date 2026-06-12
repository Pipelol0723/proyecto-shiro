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
import styles from './App.module.css';

export interface AppProps {
  /** Bus de producción inyectado desde `main.tsx`. Omitir en tests. */
  bus?: IEventBus<EventMap>;
}

export function App({ bus }: AppProps = {}): JSX.Element {
  return (
    <BusProvider bus={bus}>
      <CompanionProvider>
        <AppShell />
      </CompanionProvider>
    </BusProvider>
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
