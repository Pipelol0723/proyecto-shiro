/**
 * Prepara la memoria local para volver a llenar Letta desde cero (P-11a).
 * Ver `src/memory/reindex.ts` y RESTORE.md.
 *
 * Uso, con Shiro cerrado:
 *   npm run reindex-memory                    dice lo que haría
 *   npm run reindex-memory -- --yes           lo hace
 *   npm run reindex-memory -- --db <ruta>     otra memoria (la de la app instalada)
 *
 * Sin `--db` usa `./data/memory.db`, la del servidor de desarrollo: `npm run`
 * ejecuta esto dentro de `packages/core-host`.
 */

import { connect } from 'node:net';
import { parseArgs } from 'node:util';
import { describeReindex, reindexMemory } from '../src/memory/reindex.js';

const DEFAULT_DB_PATH = './data/memory.db';
const DEFAULT_PORT = 9876;

/** ¿Hay algo escuchando en el puerto del `core-host`? */
function isAppRunning(): Promise<boolean> {
  const port = Number(process.env.SHIRO_HOST_PORT ?? DEFAULT_PORT);
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (running: boolean): void => {
      socket.destroy();
      resolve(running);
    };
    socket.setTimeout(1_000, () => {
      done(false);
    });
    socket.once('connect', () => {
      done(true);
    });
    socket.once('error', () => {
      done(false);
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { db: { type: 'string' }, yes: { type: 'boolean', default: false } },
  });
  const report = await reindexMemory({
    dbPath: values.db ?? DEFAULT_DB_PATH,
    apply: values.yes,
    isAppRunning,
  });
  for (const line of describeReindex(report)) console.log(line);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
