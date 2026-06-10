import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuracion de Vite para @proyecto-shiro/desktop.
 *
 * - Plugin oficial de React (Fast Refresh + JSX runtime moderno).
 * - dev server en localhost por defecto.
 * - build de produccion va a `dist/` con sourcemaps para debugging.
 *
 * **Tweaks para Tauri 2.0** (ver ADR 0024):
 * - `clearScreen: false`: evita que Vite limpie los logs de Tauri en `tauri dev`.
 * - `server.strictPort`: Tauri apunta a `http://localhost:5173` desde
 *   `tauri.conf.json`. Si el puerto está ocupado falla rápido en lugar
 *   de cambiarlo silenciosamente.
 * - `server.host` y `hmr.host`: necesario cuando se ejecuta dentro del
 *   WebView de Tauri (que arranca en una red distinta a la del host).
 * - `envPrefix`: además de `VITE_*`, exponer `TAURI_*` env vars al
 *   código del cliente (target, debug, etc.).
 *
 * El alias hacia @proyecto-shiro/core lo resuelve npm workspaces; no
 * hace falta configurarlo aqui (Vite respeta `node_modules/@proyecto-shiro/core`
 * que es un symlink al paquete local).
 *
 * Ver ADR 0008: docs/adr/0008-cliente-desktop-vite-react.md
 * Ver ADR 0024: docs/adr/0024-packaging-tauri-windows-sidecar.md
 */
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  server: {
    port: 5173,
    strictPort: true,
    host: host ?? false,
    open: !process.env.TAURI_ENV_PLATFORM,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // Cuando estamos dentro de `tauri dev`, ignorar el árbol de Rust
      // evita reloads innecesarios por cambios en `target/`.
      ignored: ['**/src-tauri/**'],
    },
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
