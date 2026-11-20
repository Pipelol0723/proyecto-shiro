/**
 * last-backup — cuándo se hizo la última copia de seguridad de la memoria.
 *
 * `npm run backup` anota cada copia en `last-backup.json`, al lado de
 * `memory.db`. Aquí solo se lee, para dos cosas: el informe de salud y el
 * aviso al arrancar. El riesgo es una copia que deja de hacerse sin que nadie
 * lo note; que el aviso salga solo es la mitigación (apartado 8.1 del plan de
 * mejora, P-11a).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LastBackupInfo, Logger } from '@proyecto-shiro/core';

/** Nombre de la anotación; el mismo que escribe `scripts/backup/memory-backup.mjs`. */
export const LAST_BACKUP_FILE = 'last-backup.json';

/** Días sin copia a partir de los que se avisa. */
export const BACKUP_WARN_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Aviso sobre la copia de seguridad, con el nivel de log que le toca. */
export interface BackupNotice {
  level: 'warn' | 'info';
  message: string;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * Lee la anotación de la última copia. `undefined` si no hay ninguna, si no
 * se puede leer o si la memoria no vive en disco: nunca lanza.
 */
export function readLastBackup(dbPath: string): LastBackupInfo | undefined {
  if (dbPath === ':memory:') return undefined;
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(join(dirname(dbPath), LAST_BACKUP_FILE), 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof record !== 'object' || record === null) return undefined;
  const { at, complete, lastCompleteAt } = record as Record<string, unknown>;
  if (!isDate(at) || typeof complete !== 'boolean') return undefined;
  return { at, complete, lastCompleteAt: isDate(lastCompleteAt) ? lastCompleteAt : null };
}

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
}

/**
 * Qué decir de la copia de seguridad, o `undefined` si está al día.
 *
 * - Sin copia, o con la última de hace 14 días o más: aviso.
 * - Con copia reciente pero sin una completa reciente: nota. La memoria local
 *   guarda todos los turnos, así que la copia sin Letta protege el historial;
 *   lo que falta es lo que Letta elabora por su cuenta.
 */
export function backupNotice(
  info: LastBackupInfo | undefined,
  now: Date,
): BackupNotice | undefined {
  if (info === undefined) {
    return {
      level: 'warn',
      message:
        'no hay ninguna copia de seguridad de la memoria anotada: haz una con `npm run backup`',
    };
  }
  const days = daysSince(info.at, now);
  if (days >= BACKUP_WARN_DAYS) {
    return {
      level: 'warn',
      message: `la última copia de seguridad de la memoria es de hace ${String(days)} días: haz otra con \`npm run backup\``,
    };
  }
  if (info.lastCompleteAt === null) {
    return {
      level: 'info',
      message:
        'hay copia reciente de la memoria, pero ninguna con el volcado de Letta: haz una con Letta en marcha',
    };
  }
  const completeDays = daysSince(info.lastCompleteAt, now);
  if (completeDays >= BACKUP_WARN_DAYS) {
    return {
      level: 'info',
      message: `la última copia con el volcado de Letta es de hace ${String(completeDays)} días: haz una con Letta en marcha`,
    };
  }
  return undefined;
}

/** Deja en el log el aviso que toque. Con la memoria solo en RAM no hay nada que copiar. */
export function logBackupNotice(logger: Logger, dbPath: string, now: Date): void {
  if (dbPath === ':memory:') return;
  const notice = backupNotice(readLastBackup(dbPath), now);
  if (notice === undefined) return;
  if (notice.level === 'warn') logger.warn(notice.message);
  else logger.info(notice.message);
}
