/**
 * Configuración Vitest para @proyecto-shiro/desktop.
 *
 * Env: jsdom — necesario para tests de React components, hooks que
 * tocan DOM (useEffect, refs), y APIs como `document.body`.
 *
 * El root vitest.workspace.ts añade este config a la matriz.
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'desktop',
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    css: {
      // CSS Modules retornan un proxy en tests para evitar parsear CSS real.
      modules: { classNameStrategy: 'non-scoped' },
    },
  },
});
