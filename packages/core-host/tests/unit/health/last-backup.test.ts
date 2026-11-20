/**
 * Tests de last-backup: cuándo fue la última copia de seguridad de la memoria
 * (`last-backup.json`, que escribe `npm run backup`) y qué aviso toca (P-11a).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Logger } from '@proyecto-shiro/core';
import {
  BACKUP_WARN_DAYS,
  backupNotice,
  logBackupNotice,
  readLastBackup,
} from '../../../src/health/last-backup.js';

const dir = mkdtempSync(join(tmpdir(), 'shiro-last-backup-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Una carpeta de datos con su `memory.db` (no hace falta que exista) y la anotación dada. */
function dataDir(name: string, record?: unknown): string {
  const folder = mkdtempSync(join(dir, `${name}-`));
  if (record !== undefined) {
    const text = typeof record === 'string' ? record : JSON.stringify(record);
    writeFileSync(join(folder, 'last-backup.json'), text);
  }
  return join(folder, 'memory.db');
}

const NOW = new Date('2026-11-20T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('readLastBackup', () => {
  it('lee la anotación que hay al lado de la memoria', () => {
    const db = dataDir('ok', {
      at: '2026-11-19T10:00:00.000Z',
      name: '20261119T100000Z',
      complete: true,
      turns: 42,
      lastCompleteAt: '2026-11-19T10:00:00.000Z',
    });

    expect(readLastBackup(db)).toEqual({
      at: '2026-11-19T10:00:00.000Z',
      complete: true,
      lastCompleteAt: '2026-11-19T10:00:00.000Z',
    });
  });

  it('sin anotación, o con una memoria que no está en disco, no hay copia conocida', () => {
    expect(readLastBackup(dataDir('sin'))).toBeUndefined();
    expect(readLastBackup(':memory:')).toBeUndefined();
  });

  it.each([
    ['un archivo roto', '{ roto'],
    ['una fecha que no es una fecha', { at: 'ayer', complete: true, lastCompleteAt: null }],
    ['sin saber si es completa', { at: '2026-11-19T10:00:00.000Z' }],
    ['algo que no es un objeto', '[]'],
  ])('%s no se da por una copia', (_label, record) => {
    expect(readLastBackup(dataDir('mal', record))).toBeUndefined();
  });

  it('una anotación sin la fecha de la última completa vale: nunca hubo una', () => {
    const db = dataDir('vieja', { at: '2026-11-19T10:00:00.000Z', complete: false });

    expect(readLastBackup(db)?.lastCompleteAt).toBeNull();
  });
});

describe('backupNotice', () => {
  it('sin ninguna copia, avisa', () => {
    expect(backupNotice(undefined, NOW)).toMatchObject({ level: 'warn' });
    expect(backupNotice(undefined, NOW)?.message).toMatch(/npm run backup/);
  });

  it(`avisa cuando la última copia tiene ${String(BACKUP_WARN_DAYS)} días o más`, () => {
    const old = { at: daysAgo(BACKUP_WARN_DAYS), complete: true, lastCompleteAt: daysAgo(14) };
    const recent = { at: daysAgo(13), complete: true, lastCompleteAt: daysAgo(13) };

    expect(backupNotice(old, NOW)).toMatchObject({ level: 'warn' });
    expect(backupNotice(old, NOW)?.message).toMatch(/hace 14 días/);
    expect(backupNotice(recent, NOW)).toBeUndefined();
  });

  it('con copia reciente pero sin Letta, lo dice sin alarmar', () => {
    const never = { at: daysAgo(1), complete: false, lastCompleteAt: null };
    const stale = { at: daysAgo(1), complete: false, lastCompleteAt: daysAgo(30) };

    expect(backupNotice(never, NOW)).toMatchObject({ level: 'info' });
    expect(backupNotice(never, NOW)?.message).toMatch(/ninguna con el volcado de Letta/);
    expect(backupNotice(stale, NOW)).toMatchObject({ level: 'info' });
    expect(backupNotice(stale, NOW)?.message).toMatch(/hace 30 días/);
  });

  it('una fecha del futuro (reloj cambiado) no avisa', () => {
    const future = { at: daysAgo(-2), complete: true, lastCompleteAt: daysAgo(-2) };

    expect(backupNotice(future, NOW)).toBeUndefined();
  });
});

describe('logBackupNotice', () => {
  function spies(): {
    logger: Logger;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  } {
    const logger = new Logger('error', { module: 'test' });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    return { logger, warn, info };
  }

  it('deja el aviso en el log con su nivel', () => {
    const { logger, warn, info } = spies();

    logBackupNotice(logger, dataDir('nunca'), NOW);
    expect(warn).toHaveBeenCalledTimes(1);

    logBackupNotice(logger, dataDir('sin-letta', { at: daysAgo(1), complete: false }), NOW);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('con una copia al día, o con la memoria solo en RAM, no dice nada', () => {
    const { logger, warn, info } = spies();
    const fresh = { at: daysAgo(2), complete: true, lastCompleteAt: daysAgo(2) };

    logBackupNotice(logger, dataDir('al-dia', fresh), NOW);
    logBackupNotice(logger, ':memory:', NOW);

    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
