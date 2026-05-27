/**
 * Entry point del cliente desktop.
 *
 * Construye el EventBus de producción con `WebSocketTransport` apuntando
 * al servidor `core-host` (ADR 0012). El URL se toma de la env var
 * `VITE_SHIRO_HOST_URL` con default `ws://localhost:9876/bus`.
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
import './themes';
import './styles/reset.css';

const DEFAULT_HOST_URL = 'ws://localhost:9876/bus';

function makeProductionBus(): IEventBus<EventMap> {
  const logger = new Logger();
  const url = import.meta.env.VITE_SHIRO_HOST_URL ?? DEFAULT_HOST_URL;
  const transport = new WebSocketTransport({ url, logger });
  return new EventBus<EventMap>({ logger, transports: [transport] });
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Element #root no encontrado en index.html');
}

createRoot(root).render(
  <StrictMode>
    <App bus={makeProductionBus()} />
  </StrictMode>,
);
