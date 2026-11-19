import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Los archivos que solo declaran tipos no tienen código que ejecutar:
      // nunca se cargan y v8 cuenta todas sus líneas como sin cubrir. Si
      // alguno gana código real, sale de esta lista.
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/interfaces/**', 'src/types/events.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
