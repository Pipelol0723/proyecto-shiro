/**
 * Setup global para tests del cliente desktop.
 *
 * Ejecutado por Vitest antes de cada archivo de test (config:
 * `setupFiles: ['./tests/setup.ts']`).
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library no limpia el DOM entre tests por defecto en
// configs sin auto-cleanup. Lo hacemos explícito para evitar nodos
// huérfanos que contaminen tests siguientes.
afterEach(() => {
  cleanup();
});
