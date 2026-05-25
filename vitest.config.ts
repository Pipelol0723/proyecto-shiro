import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@core': new URL('./src/core', import.meta.url).pathname,
      '@interfaces': new URL('./src/interfaces', import.meta.url).pathname,
      '@modules': new URL('./src/modules', import.meta.url).pathname,
      '@character': new URL('./src/character', import.meta.url).pathname,
    },
  },
});
