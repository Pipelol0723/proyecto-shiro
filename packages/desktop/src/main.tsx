/**
 * Entry point del cliente desktop.
 *
 * Por ahora: solo monta <App /> en el div#root del index.html.
 * En PRs futuros, este archivo instanciara Logger + EventBus +
 * Orchestrator del core (ADR 0010) y los expondra via BusProvider.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/reset.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Element #root no encontrado en index.html');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
