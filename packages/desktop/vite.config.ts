import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuracion de Vite para @proyecto-shiro/desktop.
 *
 * - Plugin oficial de React (Fast Refresh + JSX runtime moderno).
 * - dev server en localhost por defecto; abre el navegador automaticamente.
 * - build de produccion va a `dist/` con sourcemaps para debugging.
 *
 * El alias hacia @proyecto-shiro/core lo resuelve npm workspaces; no
 * hace falta configurarlo aqui (Vite respeta `node_modules/@proyecto-shiro/core`
 * que es un symlink al paquete local).
 *
 * Ver ADR 0008: docs/adr/0008-cliente-desktop-vite-react.md
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  preview: {
    port: 4173,
  },
});
