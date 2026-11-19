/**
 * Entry point del cliente desktop.
 *
 * Construye el EventBus de producción con `WebSocketTransport` apuntando
 * al servidor `core-host` (ADR 0012). El URL se toma de la env var
 * `VITE_SHIRO_HOST_URL` con default `ws://localhost:9876/bus`. El mismo URL
 * le dice al reproductor a qué servidor pedir el audio de la voz.
 *
 * El bus se pasa a `<App>` como prop. Las pruebas (jsdom) no pasan bus
 * y caen al default in-process del `BusProvider`, así nada se rompe.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  EventBus,
  Logger,
  WebSocketTransport,
  type EventMap,
  type IEventBus,
} from '@proyecto-shiro/core';
import { App } from './App';
import { DEFAULT_HOST_URL } from './audio/audio-url';
import './themes';
import './styles/reset.css';

const HOST_URL = import.meta.env.VITE_SHIRO_HOST_URL ?? DEFAULT_HOST_URL;

function makeProductionBus(): { bus: IEventBus<EventMap>; transport: WebSocketTransport } {
  const logger = new Logger();
  const transport = new WebSocketTransport({ url: HOST_URL, logger });
  return { bus: new EventBus<EventMap>({ logger, transports: [transport] }), transport };
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Element #root no encontrado en index.html');
}

const { bus, transport } = makeProductionBus();

createRoot(root).render(
  <StrictMode>
    <App bus={bus} connection={transport} hostUrl={HOST_URL} />
  </StrictMode>,
);
