/**
 * Tests de FileTtsUsageCounter (ADR 0034 §4). Siempre en un directorio
 * temporal del sistema: ningún test escribe en el cwd ni en el repo.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileTtsUsageCounter } from '../../../src/tts/tts-usage-counter.js';

describe('FileTtsUsageCounter', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'shiro-tts-usage-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const jan = (): Date => new Date(2026, 0, 15, 12, 0, 0);
  const feb = (): Date => new Date(2026, 1, 1, 0, 0, 1);

  it('empieza en cero', () => {
    const counter = new FileTtsUsageCounter({ dir: root, now: jan });
    expect(counter.record(0)).toBe(0);
  });

  it('acumula y persiste entre instancias', () => {
    const a = new FileTtsUsageCounter({ dir: root, now: jan });
    expect(a.record(2.5)).toBeCloseTo(2.5, 6);
    expect(a.record(1)).toBeCloseTo(3.5, 6);
    const b = new FileTtsUsageCounter({ dir: root, now: jan });
    expect(b.record(1.5)).toBeCloseTo(5, 6);
    const saved = JSON.parse(readFileSync(path.join(root, 'tts-usage.json'), 'utf-8')) as {
      month: string;
      seconds: number;
    };
    expect(saved.month).toBe('2026-01');
    expect(saved.seconds).toBeCloseTo(5, 6);
  });

  it('reinicia al cambiar de mes (reloj inyectado)', () => {
    let clock = jan;
    const counter = new FileTtsUsageCounter({ dir: root, now: () => clock() });
    counter.record(10);
    clock = feb;
    expect(counter.record(2)).toBeCloseTo(2, 6);
    const again = new FileTtsUsageCounter({ dir: root, now: feb });
    expect(again.record(1)).toBeCloseTo(3, 6);
  });

  it('se recupera de un JSON corrupto sin lanzar', () => {
    writeFileSync(path.join(root, 'tts-usage.json'), '{no es json', 'utf-8');
    const counter = new FileTtsUsageCounter({ dir: root, now: jan });
    expect(() => counter.record(4)).not.toThrow();
    expect(new FileTtsUsageCounter({ dir: root, now: jan }).record(0)).toBeCloseTo(4, 6);
  });

  it('crea la carpeta si no existe', () => {
    const dir = path.join(root, 'a', 'b');
    const counter = new FileTtsUsageCounter({ dir, now: jan });
    counter.record(1);
    expect(existsSync(path.join(dir, 'tts-usage.json'))).toBe(true);
  });

  it('no lanza si el directorio no es escribible', () => {
    // Un archivo ocupa el lugar de la carpeta: no se puede crear ni escribir dentro.
    const blocker = path.join(root, 'bloqueo');
    writeFileSync(blocker, 'x', 'utf-8');
    const counter = new FileTtsUsageCounter({ dir: path.join(blocker, 'data'), now: jan });
    expect(() => counter.record(3)).not.toThrow();
    expect(counter.record(2)).toBeCloseTo(5, 6);
  });
});
