// Vitest workspace orchestrator — registra los proyectos del monorepo.
// Cuando se añadan tests en packages/desktop u otros packages,
// añadir aquí el path a su vitest.config.ts.

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace(['./packages/core/vitest.config.ts']);
