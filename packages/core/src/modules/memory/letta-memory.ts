/**
 * LettaMemory — cliente del servidor Letta self-hosted construido sobre
 * el **SDK oficial** `@letta-ai/letta-client` (ver ADR 0018). Implementa
 * `IMemoryModule` completo (incluyendo búsqueda semántica) y expone
 * además `ping()` y la maquinaria de auto-provisión del agente.
 *
 * Por qué el SDK y no `fetch` a mano (ADR 0018): la API de Letta se mueve
 * rápido (endpoints, shapes de respuesta, el modelo nuevo de "archives").
 * Mantener todo eso a mano era la fuente de "tantos errores". El SDK lo
 * absorbe y queda versionado con el servidor.
 *
 * Modelo de uso (hereda de ADR 0017):
 *
 * - Letta se usa como **archival store semántico**: cada turno se guarda
 *   como un "passage" en archival memory; los reads listan o buscan ese
 *   archival. **No invocamos el flujo de agente** (mensajes con
 *   generación) — el LLM real es nuestro (Ollama/Anthropic).
 * - El agente Letta existe solo como contenedor del archival. Necesita
 *   un LLM handle y un embedding handle configurados aunque nunca
 *   generemos con él; ambos apuntan a Ollama (local-first, ver ADR 0018).
 *
 * Auto-provisión del agente:
 *
 * - Si `agent_id` viene en la config, se usa tal cual (override explícito).
 * - Si viene vacío, el `MemoryManager` orquesta la provisión: reutiliza el
 *   id persistido en el WAL si el agente sigue existiendo, o crea uno nuevo
 *   con `provisionAgent()` y lo persiste. Así la memoria se activa sola en
 *   un setup limpio, sin pegar ids a mano.
 *
 * Idempotencia y mapeo `MemoryEntry` ↔ Letta passage:
 *
 * - `text` ↔ `text` (list/create) o `content` (search): Letta usa nombres
 *   distintos según el endpoint; normalizamos al leer.
 * - `timestamp` ↔ `created_at` (list) o `timestamp` (search).
 * - `id` ↔ tag `shiro:id:<uuid>`; `role` ↔ tag `shiro:role:<user|assistant>`.
 * - `metadata` (emotion, tier, latencyMs) **no se persiste en Letta**; vive
 *   solo en el WAL local. Letta guarda lo esencial para reconstruir contexto.
 * - Si el drainer reintenta tras un timeout y crea un passage duplicado, lo
 *   aceptamos como limitación conocida (mejor un turno duplicado raro que
 *   un turno perdido).
 *
 * `userId` se ignora en los métodos: cada agente Letta está atado a un único
 * dueño del companion (multi-user futuro mantendrá un mapa userId→agentId en
 * el manager). El parámetro se respeta por contrato.
 */

import { Letta } from '@letta-ai/letta-client';
import { z } from 'zod';
import type { IMemoryModule, MemoryEntry } from '../../interfaces/IMemoryModule.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const LettaMemoryConfigSchema = z.object({
  /** URL base del servidor Letta. Default `http://localhost:8283`. */
  base_url: z.string().url().default('http://localhost:8283'),
  /**
   * ID del agente Letta que actúa como almacén. Si llega vacío, el manager
   * lo **auto-provisiona** al arrancar (ver ADR 0018) y persiste el id en
   * el WAL local. Rellenarlo a mano fuerza un agente concreto (override).
   */
  agent_id: z.string().default(''),
  /**
   * Password del servidor (auth Bearer). Solo aplica si la instalación
   * self-hosted activó `SECURE=true`. Opcional: sin password, el SDK no
   * manda header `Authorization` y funciona contra un Letta sin protección.
   */
  password: z.string().optional(),
  /** Timeout de las requests HTTP en ms. Default 5s. */
  timeout_ms: z.number().int().positive().default(5_000),

  // ── Parámetros de provisión del agente (ADR 0018) ──
  /**
   * Handle del LLM del agente (formato `provider/model`). Obligatorio para
   * crear el agente aunque nunca generemos con él (el LLM real es nuestro).
   * Reutiliza el modelo que ya corres en Ollama.
   */
  model: z.string().min(1).default('ollama/qwen2.5:3b'),
  /**
   * Endpoint de embeddings desde la PERSPECTIVA DEL SERVER Letta. Apunta a
   * la API OpenAI-compatible de Ollama. En Docker, Letta llega al Ollama del
   * host por `host.docker.internal`; el sufijo `/v1` es **obligatorio**.
   *
   * Pasamos un `embedding_config` explícito (no un handle de provider)
   * porque es lo único que funciona de forma fiable: el provider nativo de
   * Letta enruta el embedding por su cliente OpenAI hacia `{base}/embeddings`
   * sin `/v1` → 404. Ver ADR 0018.
   */
  embedding_endpoint: z.string().url().default('http://host.docker.internal:11434/v1'),
  /** Nombre del modelo de embeddings en Ollama (sin prefijo de provider). */
  embedding_model: z.string().min(1).default('mxbai-embed-large'),
  /** Dimensión del vector del modelo (mxbai-embed-large = 1024). */
  embedding_dim: z.number().int().positive().default(1024),
  /** Límite de ventana de contexto del agente Letta. */
  context_window_limit: z.number().int().positive().default(16_000),
  /** Nombre del agente auto-provisionado. */
  agent_name: z.string().min(1).default('shiro-memory'),
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

// ─── Subconjunto del SDK que usamos ───────────────────────────────────

/**
 * Superficie mínima del SDK de Letta que consume `LettaMemory`. Tipar solo
 * lo que usamos permite inyectar un cliente falso en tests sin reconstruir
 * todo el SDK. El cliente real (`new Letta(...)`) la satisface.
 */
export interface LettaClientLike {
  health(): Promise<{ status: string; version: string }>;
  agents: {
    create(
      body: {
        name?: string;
        model?: string | null;
        embedding_config?: {
          embedding_endpoint_type: 'openai';
          embedding_endpoint: string;
          embedding_model: string;
          embedding_dim: number;
          embedding_chunk_size?: number;
        };
        context_window_limit?: number | null;
        description?: string | null;
        tags?: string[] | null;
      },
      options?: { timeout?: number },
    ): Promise<{ id: string }>;
    retrieve(agentId: string): Promise<{ id: string }>;
    passages: {
      create(
        agentId: string,
        body: { text: string; created_at?: string | null; tags?: string[] | null },
      ): Promise<unknown>;
      list(
        agentId: string,
        query?: { limit?: number | null; ascending?: boolean | null },
      ): Promise<LettaPassage[]>;
      search(
        agentId: string,
        query: { query: string; top_k?: number | null },
      ): Promise<{ count: number; results: LettaSearchResult[] }>;
      delete(memoryId: string, params: { agent_id: string }): Promise<unknown>;
    };
  };
}

/** Passage tal como lo devuelven `list`/`create` del SDK. */
interface LettaPassage {
  id?: string;
  text: string;
  created_at?: string | null;
  tags?: string[] | null;
}

/** Item de resultado de `search` (usa `content`/`timestamp`, no `text`/`created_at`). */
interface LettaSearchResult {
  id: string;
  content: string;
  timestamp: string;
  tags?: string[];
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

// ─── Implementación ───────────────────────────────────────────────────

export class LettaMemory implements IMemoryModule {
  readonly id: string;
  private readonly config: LettaMemoryConfig;
  private readonly logger: Logger;
  private readonly client: LettaClientLike;
  /** Vacío hasta que se configure (override) o se auto-provisione. */
  private agentId: string;

  constructor(rawConfig: unknown, deps: ModuleDeps, client?: LettaClientLike) {
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
    this.agentId = this.config.agent_id;
    this.id = 'memory:letta';

    // La password es un secreto: viene de la config o, si no, de
    // `LETTA_SERVER_PASSWORD` (la misma var que configura el servidor en
    // docker-compose) — así hay una sola fuente de verdad para ambos lados.
    const password = this.config.password ?? process.env.LETTA_SERVER_PASSWORD;
    // `apiKey: null` → el SDK no manda header Authorization (Letta sin
    // SECURE). Con password → `Bearer <password>`. El cast puentea la
    // superficie amplia del SDK a la mínima que tipamos arriba.
    this.client =
      client ??
      new Letta({
        baseURL: this.config.base_url,
        apiKey: password ?? null,
        // El MemoryManager ya reintenta vía drainer; preferimos latencia
        // predecible a los reintentos con backoff del SDK.
        maxRetries: 0,
        timeout: this.config.timeout_ms,
      });
  }

  // ─── Provisión del agente (ADR 0018) ────────────────────────────────

  /** El id del agente activo (vacío si aún no provisionado). */
  getAgentId(): string {
    return this.agentId;
  }

  /** Fija el agente activo (lo llama el manager tras resolver/provisionar). */
  setAgentId(agentId: string): void {
    this.agentId = agentId;
  }

  /**
   * Crea un agente nuevo que actúa como almacén archival y devuelve su id.
   * Configura LLM y embeddings vía handles de Ollama (local-first).
   */
  async provisionAgent(): Promise<string> {
    const agent = await this.client.agents.create(
      {
        name: this.config.agent_name,
        model: this.config.model,
        // embedding_config explícito en vez de un handle de provider: apunta
        // directo a la API OpenAI-compat de Ollama (`/v1/embeddings`). Esto
        // evita el routing roto del provider nativo de Letta. Verificado
        // end-to-end. Ver ADR 0018.
        embedding_config: {
          embedding_endpoint_type: 'openai',
          embedding_endpoint: this.config.embedding_endpoint,
          embedding_model: this.config.embedding_model,
          embedding_dim: this.config.embedding_dim,
          embedding_chunk_size: 300,
        },
        context_window_limit: this.config.context_window_limit,
        description:
          'Almacén de memoria de Proyecto Shiro (archival store). Su flujo de agente no se invoca.',
        tags: ['proyecto-shiro', 'memory-store'],
      },
      // Crear el agente es una operación de arranque única que puede tardar
      // (Letta inicializa bloques y valida el modelo LLM de Ollama). Le damos
      // un timeout generoso, independiente del `timeout_ms` del hot path.
      { timeout: 30_000 },
    );
    return agent.id;
  }

  /**
   * Comprueba si un agente con ese id sigue existiendo. `true` si Letta lo
   * devuelve, `false` si responde 404. Otros errores se propagan (para no
   * re-provisionar por un hiccup de red y acabar con agentes duplicados).
   */
  async agentExists(agentId: string): Promise<boolean> {
    try {
      await this.client.agents.retrieve(agentId);
      return true;
    } catch (err) {
      if (statusOf(err) === 404) return false;
      throw new LettaMemoryError(`agentExists(${agentId}) falló`, statusOf(err), err);
    }
  }

  // ─── Healthcheck ────────────────────────────────────────────────────

  /**
   * Healthcheck del servidor Letta (`GET /v1/health/` vía SDK). Devuelve
   * `true` si responde 2xx en el timeout configurado; `false` en cualquier
   * otro caso (timeout, red, status no-ok). Nunca lanza — el manager lo usa
   * en loop. No requiere agente: comprueba el servidor, no el archival.
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.health();
      return true;
    } catch (err) {
      this.logger.debug(`ping falló: ${String(err)}`);
      return false;
    }
  }

  // ─── IMemoryModule ──────────────────────────────────────────────────

  async save(entry: MemoryEntry): Promise<void> {
    const agentId = this.requireAgentId();
    // El SDK lanza (APIError) en status no-2xx; sin chequeo manual de res.ok.
    await this.client.agents.passages.create(agentId, {
      text: entry.text,
      created_at: entry.timestamp,
      tags: buildTags(entry),
    });
  }

  async getRecent(userId: string, limit: number): Promise<MemoryEntry[]> {
    const agentId = this.requireAgentId();
    const passages = await this.client.agents.passages.list(agentId, {
      limit,
      ascending: false, // más reciente primero
    });
    // Reverse a orden cronológico ASC para inyectar directo como contexto del LLM.
    return passages.map((p) => passageToEntry(p, userId)).reverse();
  }

  async searchSemantic(query: string, userId: string, limit: number): Promise<MemoryEntry[]> {
    const agentId = this.requireAgentId();
    const res = await this.client.agents.passages.search(agentId, {
      query,
      top_k: limit,
    });
    return res.results.map((r) => searchResultToEntry(r, userId));
  }

  /**
   * Borra todos los passages del agente. Letta no expone bulk delete: list
   * paginado → DELETE por passage, en serie para no saturar al server.
   */
  async clear(userId: string): Promise<void> {
    void userId;
    const agentId = this.requireAgentId();
    const PAGE = 100;
    while (true) {
      const passages = await this.client.agents.passages.list(agentId, {
        limit: PAGE,
        ascending: true,
      });
      if (passages.length === 0) return;
      let deleted = 0;
      for (const passage of passages) {
        if (passage.id === undefined) continue;
        await this.client.agents.passages.delete(passage.id, { agent_id: agentId });
        deleted += 1;
      }
      // Si ninguna fila tenía id no podemos progresar — cortamos para no
      // entrar en un loop infinito listando lo mismo.
      if (deleted === 0) {
        throw new LettaMemoryError('clear: passages sin id, no se pueden borrar');
      }
    }
  }

  // ─── Internas ───────────────────────────────────────────────────────

  private requireAgentId(): string {
    if (this.agentId === '') {
      throw new LettaMemoryError('LettaMemory: agente no provisionado todavía (agent_id vacío)');
    }
    return this.agentId;
  }
}

// ─── Helpers de mapeo ─────────────────────────────────────────────────

function passageToEntry(passage: LettaPassage, userId: string): MemoryEntry {
  const { id, role } = extractFromTags(passage.tags);
  return {
    id: id ?? passage.id ?? '',
    role: role ?? 'user',
    text: passage.text,
    timestamp: passage.created_at ?? new Date().toISOString(),
    userId,
  };
}

function searchResultToEntry(result: LettaSearchResult, userId: string): MemoryEntry {
  const { id, role } = extractFromTags(result.tags);
  return {
    id: id ?? result.id,
    role: role ?? 'user',
    text: result.content,
    timestamp: result.timestamp,
    userId,
  };
}

/** Extrae el `status` HTTP de un error del SDK, si lo tiene. */
function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}
