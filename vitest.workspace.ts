// Vitest workspace orchestrator — registra los proyectos del monorepo.
// Cuando se añada un paquete nuevo con tests, añade aquí su vitest.config.ts.

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './packages/core/vitest.config.ts',
  './packages/core-host/vitest.config.ts',
  './packages/desktop/vitest.config.ts',
]);
