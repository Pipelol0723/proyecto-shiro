/**
 * Tipos de variables de entorno expuestas a Vite.
 *
 * Vite expone solo las variables con prefijo `VITE_` a `import.meta.env`.
 * Declararlas aquí evita que TypeScript las trate como `any` y permite
 * autocompletado.
 */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * URL del WebSocket del `core-host`. Default
   * `ws://localhost:9876/bus` cuando se omite. Ver ADR 0012.
   */
  readonly VITE_SHIRO_HOST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
