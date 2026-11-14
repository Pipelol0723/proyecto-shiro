/**
 * FileTtsUsageCounter — contador mensual de segundos sintetizados (ADR 0034 §4).
 *
 * Implementa `TtsUsageSink` guardando `{ month: 'YYYY-MM', seconds }` en
 * `<dir>/tts-usage.json`. El mes es el de la hora local: el dato es informativo
 * (la alerta de gasto de Google manda). Al cambiar el mes empieza de cero.
 *
 * Nunca lanza: la escritura es atómica (archivo temporal + `renameSync`) y, si
 * falla, se reintenta directa; si también falla, avisa una sola vez y sigue
 * contando en memoria. Un JSON roto o ilegible empieza de cero con aviso (y la
 * siguiente escritura lo sobrescribe). Si la escritura directa se corta a medias
 * queda un JSON truncado, que el siguiente arranque trata como roto.
 *
 * Se espera un único escritor por archivo: el estado se carga una vez y vive en
 * memoria, así que dos instancias sobre el mismo archivo se pisarían. Crea una
 * sola y compártela (el bootstrap carga cada proveedor una vez).
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger, TtsUsageSink } from '@proyecto-shiro/core';

export interface FileTtsUsageCounterOptions {
  /** Carpeta donde vive `tts-usage.json`. */
  dir: string;
  /** Reloj inyectable para tests. */
  now?: () => Date;
  logger?: Logger;
}

interface UsageState {
  month: string;
  seconds: number;
}

const FILE_NAME = 'tts-usage.json';

export class FileTtsUsageCounter implements TtsUsageSink {
  private readonly file: string;
  private readonly now: () => Date;
  private readonly logger: Logger | undefined;
  private state: UsageState | undefined;
  private writeWarned = false;

  constructor(options: FileTtsUsageCounterOptions) {
    this.file = path.join(options.dir, FILE_NAME);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger?.child({ module: 'FileTtsUsageCounter' });
  }

  record(seconds: number): number {
    const month = this.currentMonth();
    this.state ??= this.load(month);
    if (this.state.month !== month) this.state = { month, seconds: 0 };
    if (Number.isFinite(seconds) && seconds > 0) {
      this.state.seconds += seconds;
      this.persist(this.state);
    }
    return this.state.seconds;
  }

  private currentMonth(): string {
    const d = this.now();
    return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Lee el archivo; si falta empieza de cero, si está roto empieza de cero con aviso. */
  private load(month: string): UsageState {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn('Contador de TTS: no se pudo leer el archivo; se empieza de cero.');
      }
      return { month, seconds: 0 };
    }
    try {
      const data = JSON.parse(raw) as Partial<UsageState> | null;
      if (
        data !== null &&
        typeof data.month === 'string' &&
        typeof data.seconds === 'number' &&
        Number.isFinite(data.seconds) &&
        data.seconds >= 0
      ) {
        return { month: data.month, seconds: data.seconds };
      }
    } catch {
      // cae al aviso de abajo
    }
    this.logger?.warn('Contador de TTS: el archivo está corrupto; se empieza de cero.');
    return { month, seconds: 0 };
  }

  private persist(state: UsageState): void {
    const json = JSON.stringify(state);
    const tmp = `${this.file}.${String(process.pid)}.tmp`;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(tmp, json, 'utf-8');
      renameSync(tmp, this.file);
      return;
    } catch {
      // En Windows el rename puede dar EPERM/EBUSY: se prueba la escritura directa.
      try {
        rmSync(tmp, { force: true });
      } catch {
        // ignorado
      }
    }
    try {
      writeFileSync(this.file, json, 'utf-8');
    } catch {
      if (!this.writeWarned) {
        this.writeWarned = true;
        this.logger?.warn(
          'Contador de TTS: no se puede escribir el archivo; se sigue contando solo en memoria.',
        );
      }
    }
  }
}
