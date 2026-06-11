/**
 * App — layout final del cliente desktop.
 *
 * Sustituye el playground del PR B por la estructura real: BusProvider
 * envuelve todo, Sidebar elige pantalla, Header muestra título + tema.
 * Las 5 pantallas conviven; solo se renderiza la activa.
 *
 * El reducer + suscripciones al bus viven dentro de
 * `ConversationScreen` vía `useCompanionState`. Las otras 4 pantallas
 * son stubs estáticos sin acoplamiento al state del companion.
 *
 * El `bus` se inyecta desde `main.tsx` (producción) con
 * `WebSocketTransport` al server. Si se omite (tests, demos), el
 * `BusProvider` cae al default `InProcessTransport`.
 */

import { useState } from 'react';
import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import { BusProvider } from './bus-context';
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
  const [theme, setTheme] = useState<ThemeName>('kawaii');
  const [screen, setScreen] = useState<ScreenId>('chat');

  return (
    <BusProvider bus={bus}>
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
    </BusProvider>
  );
}
