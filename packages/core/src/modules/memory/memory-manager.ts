/**
 * MemoryManager — orquestador del WAL (LocalMemory) + Letta canónico.
 *
 * Implementa `IMemoryModule` y delega:
 *
 * - **save**: escribe primero a SQLite (síncrono, sub-ms, fail-safe) y
 *   acto seguido intenta empujar a Letta. Si Letta confirma, marca la
 *   fila local como sincronizada. Si Letta falla o está caído, la fila
 *   se queda con `synced_at = NULL` y el drainer la reintentará cuando
 *   Letta vuelva.
 *
 * - **getRecent / searchSemantic**: delegan en Letta. Si Letta está
 *   caído según el último healthcheck, devuelven `[]` rápido (sin
 *   pagar el timeout) y se loguea. El pipeline procede sin contexto
 *   ese turno; el save sigue funcionando porque va al WAL.
 *
 * - **clear**: borra en ambos backends.
 *
 * El drainer corre en un `setInterval` (default cada 5s):
 *
 *   1. Ping a Letta. Detecta transiciones up↔down y loguea.
 *   2. Si Letta down, salta (las nuevas entradas se acumulan en local).
 *   3. Si Letta up y hay pendientes, las empuja en orden cronológico
 *      hasta un `batch_size`. Si una falla, marca Letta como down y
 *      corta el ciclo (siguiente ciclo reintentará).
 *
 * Ver ADR 0017 sección "MemoryManager con write-ahead log".
 */

import { z } from 'zod';
import type { IMemoryModule, MemoryEntry } from '../../interfaces/IMemoryModule.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import { LettaMemory, LettaMemoryConfigSchema } from './letta-memory.js';
import { LocalMemory } from './local-memory.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const MemoryManagerConfigSchema = z.object({
  /**
   * Identificador del usuario. Hoy solo se usa un valor constante
   * (`'default'`); ver ADR 0017 sobre multi-user futuro.
   */
  user_id: z.string().min(1).default('default'),

  /** Configuración del cliente Letta (almacén canónico). */
  letta: LettaMemoryConfigSchema,

  /** Configuración del WAL local (SQLite). */
  local: z
    .object({
      db_path: z.string().min(1).default('./data/memory.db'),
    })
    .default({ db_path: './data/memory.db' }),

  /** Configuración del drainer en background. */
  drainer: z
    .object({
      interval_ms: z.number().int().positive().default(5_000),
      batch_size: z.number().int().positive().default(100),
    })
    .default({ interval_ms: 5_000, batch_size: 100 }),
});

export type MemoryManagerConfig = z.infer<typeof MemoryManagerConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class MemoryManagerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MemoryManagerError';
  }
}

// ─── Opciones de DI (testing) ─────────────────────────────────────────

export interface MemoryManagerBackends {
  /** LocalMemory pre-construido (típicamente para tests con `:memory:`). */
  local?: LocalMemory;
  /** LettaMemory pre-construido (típicamente con `fetch` mockeado). */
  letta?: LettaMemory;
}

// ─── Implementación ───────────────────────────────────────────────────

export class MemoryManager implements IMemoryModule {
  readonly id: string;
  private readonly config: MemoryManagerConfig;
  private readonly logger: Logger;
  private readonly letta: LettaMemory;
  private readonly local: LocalMemory;

  /** Cache del último ping a Letta. Lo actualiza el drainer y los reads. */
  private lettaUp = false;
  private drainerTimer: ReturnType<typeof setInterval> | undefined;
  private drainerInFlight = false;
  private stopped = false;

  constructor(rawConfig: unknown, deps: ModuleDeps, backends: MemoryManagerBackends = {}) {
    const parsed = MemoryManagerConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new MemoryManagerError(
        `MemoryManager: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.logger = deps.logger.child({ module: 'MemoryManager' });

    this.local = backends.local ?? new LocalMemory({ dbPath: this.config.local.db_path });
    this.letta = backends.letta ?? new LettaMemory(this.config.letta, deps);

    this.id = `memory:manager:${this.config.user_id}`;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Arranca el drainer. Llamar tras `orchestrator.init()`. Hace un
   * primer ping para conocer el estado inicial de Letta.
   */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new MemoryManagerError('start() llamado tras stop()');
    }
    if (this.drainerTimer !== undefined) {
      this.logger.warn('start() llamado dos veces, ignorando segunda llamada');
      return;
    }
    await this.checkLetta();
    if (!this.lettaUp) {
      const pending = this.local.pendingCount();
      this.logger.warn(
        `Letta no responde al arrancar — ${pending} entradas pendientes en WAL. ` +
          `El drainer reintentará cada ${this.config.drainer.interval_ms}ms.`,
      );
    }
    this.drainerTimer = setInterval(() => {
      this.runDrainerCycle().catch((err: unknown) => {
        this.logger.warn(`drainer ciclo lanzó inesperadamente: ${String(err)}`);
      });
    }, this.config.drainer.interval_ms);
    this.logger.info(
      `drainer arrancado (interval=${this.config.drainer.interval_ms}ms, batch=${this.config.drainer.batch_size})`,
    );
  }

  /** Para el drainer y cierra el WAL local. Idempotente. */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    if (this.drainerTimer !== undefined) {
      clearInterval(this.drainerTimer);
      this.drainerTimer = undefined;
    }
    this.local.close();
    this.logger.info('memory manager apagado');
    return Promise.resolve();
  }

  // ─── IMemoryModule ──────────────────────────────────────────────────

  async save(entry: MemoryEntry): Promise<void> {
    // 1. SQLite: síncrono, sub-ms, garantiza no-pérdida.
    this.local.save(entry);

    // 2. Push inmediato a Letta si está vivo. Si falla, queda en el WAL
    //    para que el drainer lo recupere — sin ruido.
    if (!this.lettaUp) return;
    try {
      await this.letta.save(entry);
      this.local.markSynced(entry.id);
    } catch (err) {
      this.logger.warn(`push inmediato a Letta falló (entry ${entry.id}): ${String(err)}`);
      this.lettaUp = false;
    }
  }

  async getRecent(userId: string, limit: number): Promise<MemoryEntry[]> {
    if (!this.lettaUp) {
      this.logger.debug('getRecent: Letta down, devolviendo []');
      return [];
    }
    try {
      return await this.letta.getRecent(userId, limit);
    } catch (err) {
      this.logger.warn(`getRecent: Letta falló — devolviendo []. ${String(err)}`);
      this.lettaUp = false;
      return [];
    }
  }

  async searchSemantic(query: string, userId: string, limit: number): Promise<MemoryEntry[]> {
    if (!this.lettaUp) {
      this.logger.debug('searchSemantic: Letta down, devolviendo []');
      return [];
    }
    try {
      return await this.letta.searchSemantic(query, userId, limit);
    } catch (err) {
      this.logger.warn(`searchSemantic: Letta falló — devolviendo []. ${String(err)}`);
      this.lettaUp = false;
      return [];
    }
  }

  async clear(userId: string): Promise<void> {
    // Borra en local siempre (síncrono).
    this.local.clear(userId);
    // Borra en Letta solo si está arriba — si está down, el archival
    // queda sin tocar y el usuario lo verá tras la siguiente conexión.
    // Documentado como limitación en el ADR 0017.
    if (this.lettaUp) {
      try {
        await this.letta.clear(userId);
      } catch (err) {
        this.logger.warn(`clear: Letta falló — local borrado, Letta no. ${String(err)}`);
        this.lettaUp = false;
      }
    }
  }

  // ─── Testing helpers ────────────────────────────────────────────────

  /** Solo para tests/diagnostics. */
  isLettaUp(): boolean {
    return this.lettaUp;
  }

  /** Solo para tests/diagnostics. */
  pendingCount(): number {
    return this.local.pendingCount();
  }

  /**
   * Solo para tests: ejecuta un ciclo del drainer sincrónicamente sin
   * esperar al `setInterval`. Tras `start()`, los tests pueden forzar
   * un drenado inmediato con este método.
   */
  async runDrainerOnce(): Promise<void> {
    await this.runDrainerCycle();
  }

  // ─── Internas ───────────────────────────────────────────────────────

  private async runDrainerCycle(): Promise<void> {
    if (this.drainerInFlight || this.stopped) return;
    this.drainerInFlight = true;
    try {
      await this.checkLetta();
      if (!this.lettaUp) return;

      const pending = this.local.getPending(this.config.drainer.batch_size);
      if (pending.length === 0) return;

      this.logger.info(`drenando ${pending.length} entradas pendientes a Letta`);
      let drained = 0;
      for (const entry of pending) {
        try {
          await this.letta.save(entry);
          this.local.markSynced(entry.id);
          drained += 1;
        } catch (err) {
          this.logger.warn(`drainer falló en entry ${entry.id}: ${String(err)}`);
          this.lettaUp = false;
          break; // resto se reintenta en el próximo ciclo
        }
      }
      if (drained > 0) {
        this.logger.info(`drenadas ${drained}/${pending.length}`);
      }
    } finally {
      this.drainerInFlight = false;
    }
  }

  private async checkLetta(): Promise<void> {
    const wasUp = this.lettaUp;
    const up = await this.letta.ping();
    this.lettaUp = up;
    if (!wasUp && up) {
      this.logger.info('Letta volvió arriba');
    } else if (wasUp && !up) {
      this.logger.warn('Letta cayó');
    }
  }
}
