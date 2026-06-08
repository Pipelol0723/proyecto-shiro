/**
 * Live2DAvatar — módulo lógico server-side del avatar Live2D.
 *
 * **No carga PIXI ni renderiza nada**. Vive en `@proyecto-shiro/core` y
 * por contrato se instancia en el `core-host` (Node). El render real
 * sucede en el cliente desktop, que monta un `PIXI.Application` con
 * `pixi-live2d-display`. Este módulo es la cabeza lógica del slot
 * `avatar` del orchestrator: maneja la **resolución emoción →
 * expressionName** desde el character YAML y mantiene la **expresión
 * actual** como estado server-side accesible.
 *
 * **Por qué existe entonces** (en lugar de seguir con `NoopAvatar`):
 *
 * - **Resolución centralizada**: `emotions[emotion].avatar_expression`
 *   del YAML se traduce a un nombre de archivo de expresión del modelo
 *   (`default.exp3.json`, `smile.exp3.json`, …) aquí, no en el cliente.
 *   Cuando llegue multi-cliente, todos verán la misma expresión.
 * - **Config validada**: `model_path`, `max_fps`, `cubism_core_url`,
 *   `idle_expression` se validan con zod y se exponen como getters.
 *   El cliente leerá estos valores en su bootstrap (PR siguiente).
 * - **Mapeo provisional Hiyori**: mientras Hiyori es el modelo
 *   placeholder, el constructor recibe un `expressionAliases` opcional
 *   que traduce nombres del YAML al modelo. Ver `hiyori-expression-aliases.ts`.
 *
 * **Lo que NO hace este módulo**:
 *
 * - No carga el modelo `.moc3` (lo hace el cliente con PixiJS).
 * - No analiza audio para lip-sync (lo hace el cliente con Web Audio API
 *   sobre el `HTMLAudioElement` del TTS — ver ADR 0021 sección 5).
 * - No emite eventos `avatar:*` propios — el cliente ya escucha
 *   `llm:responded { emotion }` y reacciona directamente. Si en el
 *   futuro hace falta un evento server→cliente específico del avatar
 *   (p.ej. "trigger blink"), se añade aquí sin romper nada.
 *
 * `setExpression`, `startLipSync` y `stop` del `IAvatarModule` se
 * mantienen para respetar la interfaz, pero su efecto server-side es
 * limitado a actualizar el state interno. El cliente reacciona al
 * stream de eventos (`llm:responded`, `tts:audio`) por su cuenta.
 *
 * Ver [ADR 0021](../../../../docs/adr/0021-avatar-live2d-pixi-display-fallback-orbe.md).
 */

import { z } from 'zod';
import type { Character } from '../../character/schema.js';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import type { IAvatarModule } from '../../interfaces/IAvatarModule.js';
import type { Emotion } from '../../types/emotions.js';

// ─── Schema de config ─────────────────────────────────────────────────

export const Live2DAvatarConfigSchema = z.object({
  /**
   * Ruta al `.model3.json` del modelo Live2D. El cliente la recibe
   * (vía bootstrap o config compartida) y la pasa a `pixi-live2d-display`.
   * Default apunta al placeholder Hiyori que se descarga manualmente —
   * ver README del hito Avatar Live2D.
   */
  model_path: z.string().min(1).default('/live2d/models/Hiyori/Hiyori.model3.json'),
  /**
   * URL del script `Live2DCubismCore.js` que `pixi-live2d-display`
   * necesita en `window`. Bajado manualmente desde la web oficial de
   * Live2D (propietario, fuera del repo). Default apunta a
   * `public/live2d/Core/` del cliente desktop.
   */
  cubism_core_url: z.string().min(1).default('/live2d/Core/live2dcubismcore.js'),
  /**
   * Cap de fps del render. Default 30 para no presionar la GPU compartida
   * con Ollama/Whisper en hardware limitado (GTX 1650). Configurable
   * para subir a 60 con GPUs mejores (RTX 5080) sin recompilar. Ver
   * ADR 0021 sección 4.
   */
  max_fps: z.number().int().positive().default(30),
  /**
   * Si `true`, el cliente reproduce las motions idle (animación de
   * cuerpo) del modelo. Default **false**: las motions idle de Hiyori
   * tocan `ParamMouthOpenY` y compiten con el lip-sync, haciendo que la
   * boca parezca desincronizada. El modelo igual respira y parpadea
   * (managers aparte). Súbelo a `true` para recuperar las motions de
   * cuerpo. Ver ADR 0021 §5.
   */
  idle_animation: z.boolean().default(false),
  /**
   * Nombre de la expresión "idle" — la que el avatar muestra al arrancar
   * y a la que vuelve tras `stop()`. Default `idle` para alinearse con
   * el YAML; el `expressionAliases` traduce a un nombre del modelo si
   * hace falta (ver Hiyori).
   */
  idle_expression: z.string().min(1).default('idle'),
});

export type Live2DAvatarConfig = z.infer<typeof Live2DAvatarConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class Live2DAvatarError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'Live2DAvatarError';
  }
}

// ─── Opciones del constructor ─────────────────────────────────────────

export interface Live2DAvatarOptions {
  /**
   * Mapeo `Emotion → { avatar_expression }` desde el character YAML
   * activo. Igual patrón que `ElevenLabsTTSOptions.emotions`: el factory
   * del bootstrap lo pasa via closure. Si no se proporciona o no
   * contiene la emoción del request, se cae al `idle_expression`.
   */
  emotions?: Character['emotions'];
  /**
   * Mapeo `nombre lógico del YAML → nombre de archivo del modelo real`.
   * Solo necesario mientras el modelo no se llame igual que el YAML
   * (caso típico hoy: Hiyori usa `default/smile/anger/surprise` mientras
   * el YAML usa `idle/smirk/thinking/annoyed/soft`).
   *
   * Si una clave NO existe en el alias, se devuelve el nombre del YAML
   * tal cual — no es un error.
   *
   * Ver `hiyori-expression-aliases.ts`.
   */
  expressionAliases?: Readonly<Record<string, string>>;
}

// ─── Implementación ───────────────────────────────────────────────────

export class Live2DAvatar implements IAvatarModule {
  readonly id = 'avatar:live2d';
  private readonly config: Live2DAvatarConfig;
  private readonly logger: Logger;
  private readonly emotions: Character['emotions'] | undefined;
  private readonly expressionAliases: Readonly<Record<string, string>>;
  private currentExpression: string;
  private lipSyncActive = false;

  constructor(rawConfig: unknown, deps: ModuleDeps, options: Live2DAvatarOptions = {}) {
    const parsed = Live2DAvatarConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new Live2DAvatarError(
        `Live2DAvatar: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.logger = deps.logger.child({ module: 'Live2DAvatar' });
    this.emotions = options.emotions;
    this.expressionAliases = options.expressionAliases ?? {};
    // Aplica el alias también al idle inicial — si el modelo solo
    // entiende `default` y el YAML dice `idle`, el primer estado interno
    // debe ya estar en el namespace del modelo. Así un consumidor que
    // lea `currentExpression` recibe siempre un nombre que el modelo
    // entiende, sin tener que aplicar el alias de nuevo.
    this.currentExpression = this.applyAlias(this.config.idle_expression);

    this.logger.debug(
      `inicializado — model_path=${this.config.model_path}, max_fps=${String(this.config.max_fps)}, ` +
        `idle=${this.currentExpression}`,
    );
  }

  // ─── IAvatarModule ──────────────────────────────────────────────────

  setExpression(emotion: Emotion): Promise<void> {
    const expression = this.resolveExpression(emotion);
    if (expression !== this.currentExpression) {
      this.logger.debug(`setExpression(${emotion}) → ${expression}`);
      this.currentExpression = expression;
    }
    return Promise.resolve();
  }

  /**
   * No-op server-side: el lip-sync real lo hace el cliente analizando
   * el `HTMLAudioElement` del TTS con Web Audio API (ADR 0021 sección 5).
   * Mantenemos el estado `lipSyncActive` para que un futuro consumidor
   * server-side pueda saber si "el avatar está hablando" sin tener que
   * acoplarse al cliente. El `_audio` se ignora explícitamente.
   */
  startLipSync(_audio: Buffer): Promise<void> {
    this.lipSyncActive = true;
    return Promise.resolve();
  }

  /**
   * Detiene cualquier "animación en curso" (server-side: solo flips
   * de state). Vuelve a la expresión idle.
   */
  stop(): Promise<void> {
    this.lipSyncActive = false;
    this.currentExpression = this.applyAlias(this.config.idle_expression);
    return Promise.resolve();
  }

  // ─── Getters públicos (para el cliente y para tests) ────────────────

  /**
   * Nombre de expresión que el avatar está mostrando ahora mismo, ya
   * traducido por los aliases (es decir, en el namespace del modelo).
   * El cliente puede leer esto al conectar o tras un evento para saber
   * qué cara debe enseñar.
   */
  get expression(): string {
    return this.currentExpression;
  }

  /** True si `startLipSync` fue llamado y `stop` aún no. */
  get isLipSyncing(): boolean {
    return this.lipSyncActive;
  }

  /** Path del `.model3.json` configurado. El cliente lo necesita. */
  get modelPath(): string {
    return this.config.model_path;
  }

  /** URL del Cubism Core JS. El cliente lo carga dinámicamente. */
  get cubismCoreUrl(): string {
    return this.config.cubism_core_url;
  }

  /** Cap de fps. El cliente lo aplica a `PIXI.Ticker`. */
  get maxFps(): number {
    return this.config.max_fps;
  }

  /** Si la animación idle automática debe correr. */
  get idleAnimation(): boolean {
    return this.config.idle_animation;
  }

  /**
   * Snapshot de la config completa — útil para que el cliente la pida
   * via un endpoint HTTP o un evento del bus en el PR del render.
   */
  getConfig(): Readonly<Live2DAvatarConfig> {
    return this.config;
  }

  /**
   * Resuelve emoción → nombre de expresión del modelo. Pública para que
   * el cliente pueda calcular el nombre por su cuenta cuando escucha
   * `llm:responded { emotion }` directamente sin pasar por
   * `setExpression`. Las dos vías deben coincidir.
   *
   * Algoritmo:
   *
   *   1. Busca `emotions[emotion].avatar_expression` del YAML.
   *   2. Si no existe (ni la emoción, ni el campo), cae a `idle_expression`.
   *   3. Aplica `expressionAliases` para traducir al namespace del modelo.
   */
  resolveExpression(emotion: Emotion | undefined): string {
    const fromYaml =
      emotion === undefined ? undefined : this.emotions?.[emotion]?.avatar_expression;
    const logical = fromYaml ?? this.config.idle_expression;
    return this.applyAlias(logical);
  }

  // ─── Privados ───────────────────────────────────────────────────────

  private applyAlias(name: string): string {
    return this.expressionAliases[name] ?? name;
  }
}
