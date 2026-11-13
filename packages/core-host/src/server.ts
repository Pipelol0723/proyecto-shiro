/**
 * Entry point del servidor core-host.
 *
 * Lee variables de entorno (`SHIRO_HOST_PORT`, `LOG_LEVEL`), arranca el
 * bootstrap y registra handlers de SIGINT/SIGTERM para apagado limpio.
 *
 * Lanzar con:
 *   npm run dev -w @proyecto-shiro/core-host
 *
 * O junto al cliente desktop desde la raíz:
 *   npm run dev
 *
 * Ver ADR 0012 (split cliente/server).
 */

import { Logger } from '@proyecto-shiro/core';
import { CharacterLoader, ConfigLoader } from '@proyecto-shiro/core/node';
import { bootstrap } from './bootstrap.js';
import { loadSecretsEnv } from './secrets/secrets-file.js';
import { resolveBindHost } from './transports/bind-host.js';

const DEFAULT_PORT = 9876;
/**
 * Paths relativos al cwd del proceso. Cuando se arranca con
 * `npm run dev -w @proyecto-shiro/core-host` o `npm run dev` desde la
 * raíz, el cwd es `packages/core-host/` — de ahí los `../..`. Override
 * con `SHIRO_MODULES_CONFIG` y `SHIRO_CHARACTER` si el server corre
 * desde otro sitio.
 */
const DEFAULT_CONFIG_PATH = '../../config/modules.config.yaml';
const DEFAULT_CHARACTER_PATH = '../core/src/character/characters/default.yaml';

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 65_535) {
    console.error(`SHIRO_HOST_PORT inválido: "${raw}". Usando default ${DEFAULT_PORT}.`);
    return DEFAULT_PORT;
  }
  return n;
}

async function main(): Promise<void> {
  // Carga las API keys persistidas por el wizard de Setup (binario
  // empaquetado) ANTES de construir los módulos — el `.env` de dev y las
  // env vars reales tienen prioridad. Ver ADR 0024 §6.
  const loadedSecrets = loadSecretsEnv(process.cwd());

  const port = parsePort(process.env.SHIRO_HOST_PORT);
  const logger = new Logger();
  if (loadedSecrets.length > 0) {
    logger
      .child({ module: 'secrets' })
      .info(`keys cargadas de secrets.env: ${loadedSecrets.join(', ')}`);
  }
  const configPath = process.env.SHIRO_MODULES_CONFIG ?? DEFAULT_CONFIG_PATH;
  const characterPath = process.env.SHIRO_CHARACTER ?? DEFAULT_CHARACTER_PATH;
  const config = new ConfigLoader({ logger }).loadModulesConfig(configPath);
  const character = new CharacterLoader({ logger }).loadFromFile(characterPath);
  const bind = resolveBindHost(process.env);
  if (!bind.isLoopback) {
    logger.warn(
      `SHIRO_BIND_HOST=${bind.host} no es loopback: el bus queda sin auth en la red hasta P-40 (ADR 0027 2b)`,
    );
  }
  const result = await bootstrap({ port, host: bind.host, config, character, logger });

  const shutdown = (signal: string): void => {
    console.log(`\nrecibido ${signal}, apagando…`);
    result
      .shutdown()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error('error apagando', err);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

/** `code` del error (p. ej. `EADDRINUSE`), si lo tiene. */
function errorCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: unknown }).code
    : undefined;
}

/** `true` si el error es un EADDRINUSE (puerto ya ocupado). */
function isAddrInUse(err: unknown): boolean {
  return errorCode(err) === 'EADDRINUSE';
}

/** `listen()` no pudo usar el host pedido: no resuelve o no es de esta máquina. */
function isBindHostUnusable(err: unknown): boolean {
  const code = errorCode(err);
  return (
    (code === 'ENOTFOUND' || code === 'EADDRNOTAVAIL') &&
    (process.env.SHIRO_BIND_HOST ?? '').trim() !== ''
  );
}

main().catch((err: unknown) => {
  if (isAddrInUse(err)) {
    // El puerto ya lo tiene otro core-host. Pasa típicamente en `tauri dev`
    // si quedó un `npm run dev` corriendo, o si se abren dos instancias del
    // binario. No es un fallo real: este proceso se aparta en silencio y
    // deja servir al que llegó primero (el sidecar es best-effort, ADR 0024
    // §2). Salimos con código 0 para que el lanzador no lo marque como crash.
    console.warn(
      `core-host: el puerto ${String(process.env.SHIRO_HOST_PORT ?? DEFAULT_PORT)} ya está en uso — ` +
        'ya hay otro core-host corriendo. Este proceso se cierra limpiamente.',
    );
    process.exit(0);
  }
  if (isBindHostUnusable(err)) {
    console.error(
      `core-host: no se puede escuchar en SHIRO_BIND_HOST=${String(process.env.SHIRO_BIND_HOST)} ` +
        `(${String(errorCode(err))}). Debe ser una IP de esta máquina, 0.0.0.0 o localhost.`,
    );
    process.exit(1);
  }
  console.error('fallo al arrancar core-host:', err);
  process.exit(1);
});
