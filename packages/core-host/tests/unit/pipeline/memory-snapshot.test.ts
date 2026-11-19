/**
 * Lo que viaja al cliente en `memory:snapshot` (revisión de P-10).
 *
 * Con el historial saliendo de SQLite, los turnos `tool` llegan con su
 * metadata: argumentos enteros y salida de la herramienta. El chat no los
 * enseña, así que no tienen por qué viajar.
 */

import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '@proyecto-shiro/core';
import { toSnapshotEntries } from '../../../src/pipeline/memory-snapshot.js';

const base = { timestamp: '2026-05-29T12:00:00.000Z', userId: 'me' };

describe('toSnapshotEntries', () => {
  it('los turnos de conversación viajan enteros, con su metadata', () => {
    const entries: MemoryEntry[] = [
      { ...base, id: 'u', role: 'user', text: 'hola' },
      { ...base, id: 'a', role: 'assistant', text: 'hola tú', metadata: { emotion: 'happy' } },
    ];
    expect(toSnapshotEntries(entries)).toEqual(entries);
  });

  it('los turnos tool viajan sin metadata: ni argumentos ni salida', () => {
    const tool: MemoryEntry = {
      ...base,
      id: 't',
      role: 'tool',
      text: 'Ejecuté fs:write',
      metadata: {
        kind: 'tool',
        toolId: 'fs:write',
        args: { path: 'notas.txt', content: 'x'.repeat(10_000) },
        result: { ok: true, output: 'hecho' },
      },
    };

    const [sent] = toSnapshotEntries([tool]);

    expect(sent).toEqual({ ...base, id: 't', role: 'tool', text: 'Ejecuté fs:write' });
    // El turno guardado no se toca.
    expect(tool.metadata).toBeDefined();
  });
});
