/**
 * Tests de reindex: preparar la memoria local para volver a llenar Letta
 * (`npm run reindex-memory`, P-11a).
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalMemory } from '@proyecto-shiro/core/node';
import { describeReindex, reindexMemory } from '../../../src/memory/reindex.js';

const dir = mkdtempSync(join(tmpdir(), 'shiro-reindex-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

/** Una memoria en disco con tres turnos, dos ya enviados, y un agente anotado. */
function seededDb(name: string): string {
  const dbPath = join(dir, `${name}.db`);
  const local = new LocalMemory({ dbPath });
  for (const id of ['t1', 't2', 't3']) {
    local.save({
      id,
      role: 'user',
      text: 'hola',
      timestamp: '2026-11-20T10:00:00.000Z',
      userId: 'me',
    });
  }
  local.markSynced('t1');
  local.markSynced('t2');
  local.setMeta('letta_agent_id', 'agente-viejo');
  local.close();
  return dbPath;
}

/** Lo que queda en la base tras la orden. */
function state(dbPath: string): { pending: number; agentId: string | undefined } {
  const local = new LocalMemory({ dbPath });
  try {
    return { pending: local.pendingCount(), agentId: local.getMeta('letta_agent_id') };
  } finally {
    local.close();
  }
}

const idle = (): Promise<boolean> => Promise.resolve(false);

describe('reindexMemory', () => {
  it('sin confirmar, dice lo que haría y no cambia nada', async () => {
    const dbPath = seededDb('ensayo');

    const report = await reindexMemory({ dbPath, apply: false, isAppRunning: idle });

    expect(report).toEqual({ applied: false, total: 3, toResend: 2, agentId: 'agente-viejo' });
    expect(state(dbPath)).toEqual({ pending: 1, agentId: 'agente-viejo' });
  });

  it('confirmado, deja todos los turnos pendientes y olvida el agente', async () => {
    const dbPath = seededDb('aplicar');

    const report = await reindexMemory({ dbPath, apply: true, isAppRunning: idle });

    expect(report).toEqual({ applied: true, total: 3, toResend: 2, agentId: 'agente-viejo' });
    expect(state(dbPath)).toEqual({ pending: 3, agentId: undefined });
  });

  it('con Shiro en marcha no toca la memoria: el servidor tiene el agente en uso', async () => {
    const dbPath = seededDb('en-marcha');

    await expect(
      reindexMemory({ dbPath, apply: true, isAppRunning: () => Promise.resolve(true) }),
    ).rejects.toThrow(/cierra Shiro/);
    expect(state(dbPath)).toEqual({ pending: 1, agentId: 'agente-viejo' });
  });

  it('si la memoria no existe, lo dice y no crea una vacía', async () => {
    const dbPath = join(dir, 'no-existe.db');

    await expect(reindexMemory({ dbPath, apply: true, isAppRunning: idle })).rejects.toThrow(
      /no existe/,
    );
    expect(existsSync(dbPath)).toBe(false);
  });
});

describe('describeReindex', () => {
  it('sin confirmar, explica cómo aplicarlo', () => {
    const lines = describeReindex({
      applied: false,
      total: 3,
      toResend: 2,
      agentId: 'agente-viejo',
    });

    expect(lines.join('\n')).toMatch(/3 turnos/);
    expect(lines.join('\n')).toMatch(/agente-viejo/);
    expect(lines.join('\n')).toMatch(/--yes/);
    // Abrir la memoria puede migrarla: el ensayo no promete que no cambia nada.
    expect(lines.join('\n')).not.toMatch(/No se ha cambiado nada/);
    expect(lines.join('\n')).toMatch(/ningún turno/);
  });

  it('aplicado, dice qué pasará al arrancar', () => {
    const lines = describeReindex({ applied: true, total: 3, toResend: 2, agentId: undefined });

    expect(lines.join('\n')).toMatch(/al arrancar Shiro/i);
    expect(lines.join('\n')).not.toMatch(/--yes/);
  });
});
