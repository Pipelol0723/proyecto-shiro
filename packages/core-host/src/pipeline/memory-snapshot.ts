/**
 * Lo que viaja al cliente en `memory:snapshot`.
 *
 * El historial sale de SQLite, que guarda la metadata de cada turno. La de
 * los turnos `tool` lleva los argumentos enteros de la herramienta (el
 * contenido de un archivo escrito, por ejemplo) y su salida. El chat no
 * enseña esos turnos, así que su metadata no sale del servidor.
 */

import type { MemoryEntry } from '@proyecto-shiro/core';

export function toSnapshotEntries(entries: readonly MemoryEntry[]): MemoryEntry[] {
  return entries.map((entry) => {
    if (entry.role !== 'tool' || entry.metadata === undefined) return entry;
    return {
      id: entry.id,
      role: entry.role,
      text: entry.text,
      timestamp: entry.timestamp,
      userId: entry.userId,
    };
  });
}
