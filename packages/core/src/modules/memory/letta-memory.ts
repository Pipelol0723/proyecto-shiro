/**
 * LettaMemory — cliente HTTP del servidor Letta self-hosted
 * (`http://localhost:8283` por defecto). Implementa `IMemoryModule`
 * completo incluyendo búsqueda semántica.
 *
 * Modelo de uso (ver ADR 0017):
 *
 * - Letta es un sistema de **agentes con memoria**, no un store crudo.
 *   En esta primera versión lo usamos como **archival store semántico**:
 *   cada turno se guarda como un "passage" en archival memory; reads
 *   listan o buscan ese archival. **No invocamos el flujo de agente**
 *   (mensajes con generación) porque el LLM real es nuestro
 *   (Ollama/Anthropic), no el de Letta.
 *
 * - La integración del flujo de agente (core memory editable, recall
 *   memory, consolidación automática) queda como deuda explícita para
 *   un PR futuro cuando la necesidad lo justifique.
 *
 * Idempotencia:
 *
 * - Letta genera sus propios `id` para cada passage. Guardamos nuestro
 *   `MemoryEntry.id` (UUID v7) como tag `shiro:id:<uuid>`. Si el
 *   drainer del WAL reintenta tras un timeout y termina creando un
 *   passage duplicado, lo aceptamos como limitación conocida — la
 *   API de Letta no expone "create with external id" para garantizar
 *   idempotencia estricta. Para el objetivo "recordar todo lo que
 *   pueda", un turno duplicado raro es mejor que un turno perdido.
 *
 * Mapeo `MemoryEntry` ↔ Letta passage:
 *
 * - `text` ↔ `text` / `content` (Letta usa nombres distintos en list vs
 *   search; normalizamos al leer).
 * - `timestamp` ↔ `created_at` (pasamos el ISO original en el POST).
 * - `id` ↔ tag `shiro:id:<uuid>`.
 * - `role` ↔ tag `shiro:role:<user|assistant>`.
 * - `metadata` (emotion, tier, latencyMs) **no se persiste en Letta**.
 *   Vive solo en `LocalMemory` (WAL); Letta guarda lo esencial para
 *   reconstruir el contexto del LLM.
 *
 * `userId` se ignora en los métodos porque cada agente Letta está atado
 * a un único userId (un solo dueño del companion hoy; multi-user futuro
 * mantendrá un mapa userId→agentId en el manager). El parámetro se
 * respeta por contrato.
 *
 * Browser-safe: usa `fetch` global. No importa nada de Node.
 */

import { z } from 'zod';
import type { IMemoryModule, MemoryEntry } from '../../interfaces/IMemoryModule.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const LettaMemoryConfigSchema = z.object({
  /** URL base del servidor Letta. Default `http://localhost:8283`. */
  base_url: z.string().url().default('http://localhost:8283'),
  /**
   * ID del agente Letta que actúa como almacén. Debe existir antes de
   * arrancar `LettaMemory`; la creación del agente es responsabilidad
   * del bootstrap (PR 4 del hito Memoria).
   */
  agent_id: z.string().min(1, 'LettaMemory: `agent_id` es obligatorio'),
  /**
   * Password del servidor (auth Bearer). Solo aplica si la instalación
   * self-hosted activó protección por password. Opcional.
   */
  password: z.string().optional(),
  /** Timeout de las requests HTTP en ms. Default 5s. */
  timeout_ms: z.number().int().positive().default(5_000),
});

export type LettaMemoryConfig = z.infer<typeof LettaMemoryConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class LettaMemoryError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LettaMemoryError';
    this.status = status;
  }
}

// ─── Tags estructurados ───────────────────────────────────────────────

const TAG_PREFIX_ID = 'shiro:id:';
const TAG_PREFIX_ROLE = 'shiro:role:';

function buildTags(entry: MemoryEntry): string[] {
  return [`${TAG_PREFIX_ID}${entry.id}`, `${TAG_PREFIX_ROLE}${entry.role}`];
}

function extractFromTags(tags: readonly string[] | null | undefined): {
  id: string | undefined;
  role: 'user' | 'assistant' | undefined;
} {
  let id: string | undefined;
  let role: 'user' | 'assistant' | undefined;
  for (const tag of tags ?? []) {
    if (tag.startsWith(TAG_PREFIX_ID)) {
      id = tag.slice(TAG_PREFIX_ID.length);
    } else if (tag.startsWith(TAG_PREFIX_ROLE)) {
      const candidate = tag.slice(TAG_PREFIX_ROLE.length);
      if (candidate === 'user' || candidate === 'assistant') role = candidate;
    }
  }
  return { id, role };
}

// ─── Schemas de la respuesta de Letta ─────────────────────────────────

const PassageSchema = z
  .object({
    id: z.string(),
    text: z.string().optional(),
    content: z.string().optional(),
    created_at: z.string().nullable().optional(),
    timestamp: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

const ListPassagesResponseSchema = z.array(PassageSchema);

const SearchPassagesResponseSchema = z
  .object({
    results: z.array(PassageSchema),
  })
  .passthrough();

type PassageLike = z.infer<typeof PassageSchema>;

// ─── Implementación ───────────────────────────────────────────────────

export class LettaMemory implements IMemoryModule {
  readonly id: string;
  private readonly config: LettaMemoryConfig;
  private readonly logger: Logger;

  constructor(rawConfig: unknown, deps: ModuleDeps) {
    const parsed = LettaMemoryConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new LettaMemoryError(
        `LettaMemory: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.logger = deps.logger.child({ module: 'LettaMemory' });
    this.id = `memory:letta:${this.config.agent_id}`;
  }

  /**
   * Healthcheck del servidor Letta. Devuelve `true` si responde 2xx en
   * el timeout configurado; `false` en cualquier otro caso (timeout,
   * red, status no-ok). Nunca lanza — el manager lo usa en loop.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.request('GET', '/v1/health/check');
      return res.ok;
    } catch (err) {
      this.logger.debug(`ping fallo: ${String(err)}`);
      return false;
    }
  }

  async save(entry: MemoryEntry): Promise<void> {
    const body = {
      text: entry.text,
      created_at: entry.timestamp,
      tags: buildTags(entry),
    };
    const res = await this.request(
      'POST',
      `/v1/agents/${this.config.agent_id}/archival-memory`,
      body,
    );
    if (!res.ok) {
      throw await this.errorFromResponse(res, 'save');
    }
  }

  async getRecent(userId: string, limit: number): Promise<MemoryEntry[]> {
    void userId;
    const params = new URLSearchParams({
      limit: String(limit),
      ascending: 'false',
    });
    const res = await this.request(
      'GET',
      `/v1/agents/${this.config.agent_id}/archival-memory?${params.toString()}`,
    );
    if (!res.ok) throw await this.errorFromResponse(res, 'getRecent');

    const raw = await this.parseJson(res, 'getRecent');
    const passages = ListPassagesResponseSchema.parse(raw);
    // `ascending=false` → más reciente primero. Reverse a orden cronológico ASC
    // para que el caller pueda inyectarlo directamente como contexto del LLM.
    return passages.map((p) => passageToEntry(p, userId)).reverse();
  }

  async searchSemantic(query: string, userId: string, limit: number): Promise<MemoryEntry[]> {
    void userId;
    const params = new URLSearchParams({
      query,
      top_k: String(limit),
    });
    const res = await this.request(
      'GET',
      `/v1/agents/${this.config.agent_id}/archival-memory/search?${params.toString()}`,
    );
    if (!res.ok) throw await this.errorFromResponse(res, 'searchSemantic');

    const raw = await this.parseJson(res, 'searchSemantic');
    const body = SearchPassagesResponseSchema.parse(raw);
    return body.results.map((p) => passageToEntry(p, userId));
  }

  /**
   * Borra todos los passages del agente. Letta no expone bulk delete,
   * así que iteramos: list paginado → DELETE por passage. Síncrono a
   * nivel del cliente (await en serie) para no saturar al server.
   */
  async clear(userId: string): Promise<void> {
    void userId;
    const PAGE = 100;
    while (true) {
      const params = new URLSearchParams({
        limit: String(PAGE),
        ascending: 'true',
      });
      const res = await this.request(
        'GET',
        `/v1/agents/${this.config.agent_id}/archival-memory?${params.toString()}`,
      );
      if (!res.ok) throw await this.errorFromResponse(res, 'clear/list');

      const raw = await this.parseJson(res, 'clear/list');
      const passages = ListPassagesResponseSchema.parse(raw);
      if (passages.length === 0) return;

      for (const passage of passages) {
        const del = await this.request(
          'DELETE',
          `/v1/agents/${this.config.agent_id}/archival-memory/${passage.id}`,
        );
        if (!del.ok) throw await this.errorFromResponse(del, 'clear/delete');
      }
    }
  }

  // ─── Helpers internos ────────────────────────────────────────────────

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.config.base_url}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.password !== undefined && this.config.password.length > 0) {
      headers.Authorization = `Bearer ${this.config.password}`;
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.config.timeout_ms);
    init.signal = controller.signal;
    try {
      return await fetch(url, init);
    } catch (err) {
      throw new LettaMemoryError(`LettaMemory: fallo al llamar a ${url}`, undefined, err);
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorFromResponse(res: Response, op: string): Promise<LettaMemoryError> {
    const text = await res.text().catch(() => '<sin cuerpo>');
    return new LettaMemoryError(
      `LettaMemory: ${op} ${res.status} ${res.statusText} — ${text}`,
      res.status,
    );
  }

  private async parseJson(res: Response, op: string): Promise<unknown> {
    try {
      return await res.json();
    } catch (err) {
      throw new LettaMemoryError(`LettaMemory: ${op} respuesta no es JSON`, res.status, err);
    }
  }
}

function passageToEntry(passage: PassageLike, userId: string): MemoryEntry {
  const text = passage.text ?? passage.content ?? '';
  const timestamp = passage.created_at ?? passage.timestamp ?? new Date().toISOString();
  const { id, role } = extractFromTags(passage.tags);
  return {
    id: id ?? passage.id,
    role: role ?? 'user',
    text,
    timestamp,
    userId,
  };
}
