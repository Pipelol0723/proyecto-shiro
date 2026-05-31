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

/** Clave del WAL (tabla `meta`) donde se persiste el agente auto-provisionado. */
const META_AGENT_ID = 'letta_agent_id';

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

  /**
   * Parámetros que el pipeline conversacional usa al leer contexto
   * (ver ADR 0017). Los consume `wireConversationFlow` vía el getter
   * `getPipelineConfig()` del manager.
   */
  pipeline: z
    .object({
      recent_limit: z.number().int().nonnegative().default(5),
      semantic_limit: z.number().int().nonnegative().default(3),
      timeout_ms: z.number().int().positive().default(1_500),
    })
    .default({ recent_limit: 5, semantic_limit: 3, timeout_ms: 1_500 }),
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

  /**
   * Cache del estado usable de Letta = servidor sano **y** agente listo.
   * Lo actualiza el drainer y los reads.
   */
  private lettaUp = false;
  /** El agente Letta está resuelto/provisionado y listo para reads/saves. */
  private agentReady = false;
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
        `Letta no usable al arrancar (servidor caído o agente sin provisionar) — ` +
          `${String(pending)} entradas pendientes en el WAL local. El drainer reintentará ` +
          `cada ${String(this.config.drainer.interval_ms)}ms y provisionará el agente en ` +
          `cuanto Letta responda. Los turnos no se pierden mientras tanto.`,
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
      // No marcamos Letta como caída: un push lento (cold-start de embeddings)
      // no significa servidor abajo. La entrada queda pendiente y el drainer la
      // reintenta; el estado up/down lo decide el ping periódico (checkLetta).
      this.logger.warn(`push inmediato a Letta falló (entry ${entry.id}): ${String(err)}`);
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
      // El estado up/down lo decide el ping, no un read fallido (evita que un
      // hipo puntual deje a Shiro "ciego" varios turnos).
      this.logger.warn(`getRecent: Letta falló — devolviendo []. ${String(err)}`);
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
      }
    }
  }

  /**
   * Devuelve los parámetros que el pipeline conversacional necesita
   * para construir el contexto del LLM en cada turno (límite de turnos
   * recientes, límite semántico y timeout). El bootstrap los lee de
   * aquí y los pasa a `wireConversationFlow`.
   */
  getPipelineConfig(): {
    recentLimit: number;
    semanticLimit: number;
    timeoutMs: number;
  } {
    return {
      recentLimit: this.config.pipeline.recent_limit,
      semanticLimit: this.config.pipeline.semantic_limit,
      timeoutMs: this.config.pipeline.timeout_ms,
    };
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
          // Corta el batch (la entrada sigue pendiente); el próximo ciclo lo
          // reintenta. No marcamos down: lo decide el ping de checkLetta.
          this.logger.warn(`drainer falló en entry ${entry.id}: ${String(err)}`);
          break;
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
    let up = await this.letta.ping();
    // Si el servidor responde pero aún no resolvimos el agente, intentamos
    // provisionarlo ahora. Sin agente, Letta no es usable para reads/saves.
    if (up && !this.agentReady) {
      try {
        await this.ensureAgent();
        this.agentReady = true;
        // Calienta el modelo de embeddings en background (no bloquea) para que
        // el primer searchSemantic real no pague el cold-start. Ver ADR 0018.
        void this.warmUp();
      } catch (err) {
        this.logger.warn(`no se pudo provisionar/confirmar el agente Letta: ${String(err)}`);
        up = false; // se reintenta en el próximo ciclo del drainer
      }
    }
    this.lettaUp = up && this.agentReady;
    if (!wasUp && this.lettaUp) {
      this.logger.info('Letta volvió arriba');
    } else if (wasUp && !this.lettaUp) {
      this.logger.warn('Letta cayó');
    }
  }

  /**
   * Carga el modelo de embeddings de Ollama con una búsqueda descartable en
   * cuanto el agente está listo. Sin esto, el primer `searchSemantic` real
   * paga el cold-start (varios segundos) y suele expirar, dejando a Shiro sin
   * contexto semántico ese turno. Fire-and-forget: no bloquea el arranque ni
   * es crítico si falla.
   */
  private async warmUp(): Promise<void> {
    try {
      await this.letta.searchSemantic('hola', this.config.user_id, 1);
      this.logger.debug('warm-up de embeddings completado');
    } catch (err) {
      this.logger.debug(`warm-up de embeddings falló (no crítico): ${String(err)}`);
    }
  }

  /**
   * Resuelve el agente Letta a usar (ver ADR 0018):
   *  - Si la config trae `agent_id`, se usa tal cual (override explícito).
   *  - Si no, reutiliza el id persistido en el WAL si el agente sigue
   *    existiendo; si no existe (o no había), crea uno nuevo y lo persiste.
   *
   * Idempotente a nivel de ciclo: una vez `agentReady`, `checkLetta` no
   * vuelve a llamarlo.
   */
  private async ensureAgent(): Promise<void> {
    if (this.config.letta.agent_id !== '') {
      this.letta.setAgentId(this.config.letta.agent_id);
      return;
    }
    const stored = this.local.getMeta(META_AGENT_ID);
    if (stored !== undefined && stored !== '') {
      if (await this.letta.agentExists(stored)) {
        this.letta.setAgentId(stored);
        this.logger.info(`agente Letta reutilizado desde el WAL: ${stored}`);
        return;
      }
      this.logger.warn(`agente Letta persistido ${stored} ya no existe; re-provisionando`);
    }
    const id = await this.letta.provisionAgent();
    this.local.setMeta(META_AGENT_ID, id);
    this.letta.setAgentId(id);
    this.logger.info(`agente Letta provisionado y persistido en el WAL: ${id}`);
  }
}
