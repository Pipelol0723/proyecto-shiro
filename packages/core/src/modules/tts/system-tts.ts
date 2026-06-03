/**
 * SystemTTS — fallback usando la voz nativa del sistema operativo.
 *
 * Implementa `ITTSModule`. Wrapper de `say.js`:
 * - Windows: SAPI (Microsoft Aria/Davis/Anna).
 * - macOS: NSSpeechSynthesizer (Samantha y compañía).
 * - Linux: `festival` o `espeak` (requiere instalación previa).
 *
 * Su rol es **fallback** (ADR 0020): cuando `ElevenLabsTTS` falla
 * (sin internet, cuota agotada, 5xx), el pipeline cae aquí para
 * que Shiro **siempre** tenga voz, aunque genérica. No mapea
 * emoción — `say` no expone ese knob; ignoramos `request.emotion`
 * con un debug log.
 *
 * **Node-only**: `say` usa `child_process` y FS para exportar a WAV.
 * Este archivo se exporta desde `@proyecto-shiro/core/node`, no
 * desde el entry browser-safe. Ver ADR 0011.
 *
 * Flujo de `synthesize()`:
 *
 * 1. Genera un nombre de archivo temporal único en `os.tmpdir()`.
 * 2. Llama `say.export(text, voice, speed, file)`.
 * 3. Lee el archivo WAV a Buffer.
 * 4. Borra el archivo (cleanup best-effort).
 * 5. Devuelve `{ audio: Buffer, mimeType: 'audio/wav' }`.
 *
 * El WAV típico de una frase corta son ~50-200 KB — manejable en
 * memoria sin streaming. Si en el futuro las frases son enormes,
 * habría que stream-pipe el archivo al cliente.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sayModule from 'say';
import type { Logger } from '../../core/logger.js';
import type { ModuleDeps } from '../../core/module-loader.js';
import type { ITTSModule, TTSRequest, TTSResponse } from '../../interfaces/ITTSModule.js';

// ─── Tipos del módulo `say` (no hay @types/say oficial) ───────────────

interface SayLike {
  /**
   * Exporta el habla a un archivo. `voice` y `speed` pueden ser null
   * para usar los defaults del OS. El callback se invoca al terminar
   * (o con error). En Linux puede tirar si no hay `festival`/`espeak`.
   */
  export(
    text: string,
    voice: string | null,
    speed: number | null,
    filename: string,
    callback: (err: Error | null) => void,
  ): void;
  /** Lista las voces instaladas en el sistema. */
  getInstalledVoices(callback: (err: Error | null, voices: string[]) => void): void;
}

const say = sayModule as unknown as SayLike;

// ─── Schema de config ─────────────────────────────────────────────────

export const SystemTTSConfigSchema = z.object({
  /**
   * Voz del sistema a usar. Si está vacío, `say` usa la voz por defecto
   * del OS. En Windows típicamente "Microsoft David Desktop" o "Aria";
   * en macOS "Samantha"; en Linux depende de `festival`/`espeak`. Para
   * listar las disponibles: `say.getInstalledVoices(...)`.
   */
  voice: z.string().default(''),
  /**
   * Velocidad de habla. `say` lo interpreta como multiplicador (1.0 =
   * normal, 1.5 = más rápido, 0.8 = más lento). Default 1.0.
   */
  speed: z.number().positive().default(1.0),
  /**
   * Timeout para la operación de exportar a archivo. La síntesis con
   * `say` es generalmente rápida (~100-500 ms para frases cortas), pero
   * en sistemas lentos o frases largas conviene un margen.
   */
  timeout_ms: z.number().int().positive().default(15_000),
});

export type SystemTTSConfig = z.infer<typeof SystemTTSConfigSchema>;

// ─── Errores ──────────────────────────────────────────────────────────

export class SystemTTSError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SystemTTSError';
  }
}

// ─── Inyección para tests ─────────────────────────────────────────────

export interface SystemTTSDeps {
  /**
   * API del módulo `say`. Inyectable para tests sin invocar el binario
   * del SO. Si no se pasa, usa el `say` real importado del paquete.
   */
  say?: SayLike;
  /**
   * Lectura de archivo. Inyectable para tests. Default `fs.readFile`.
   */
  readFile?: (path: string) => Promise<Buffer>;
  /**
   * Borrado de archivo. Inyectable para tests. Default `fs.unlink`.
   * El borrado es best-effort: si falla, solo se loguea.
   */
  unlink?: (path: string) => Promise<void>;
  /**
   * Generador de path único. Inyectable para tests determinísticos.
   * Default: `<tmpdir>/shiro-tts-<uuid>.wav`.
   */
  makeTempPath?: () => string;
}

// ─── Implementación ───────────────────────────────────────────────────

export class SystemTTS implements ITTSModule {
  readonly id = 'tts:system';
  private readonly config: SystemTTSConfig;
  private readonly logger: Logger;
  private readonly say: SayLike;
  private readonly readFile: (path: string) => Promise<Buffer>;
  private readonly unlink: (path: string) => Promise<void>;
  private readonly makeTempPath: () => string;

  constructor(rawConfig: unknown, deps: ModuleDeps, options: SystemTTSDeps = {}) {
    const parsed = SystemTTSConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new SystemTTSError(
        `SystemTTS: config inválida — ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.logger = deps.logger.child({ module: 'SystemTTS' });
    this.say = options.say ?? say;
    this.readFile = options.readFile ?? ((p) => fs.readFile(p));
    this.unlink = options.unlink ?? ((p) => fs.unlink(p));
    this.makeTempPath =
      options.makeTempPath ?? (() => join(tmpdir(), `shiro-tts-${randomUUID()}.wav`));
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (request.text.trim().length === 0) {
      throw new SystemTTSError('SystemTTS: el texto a sintetizar está vacío.');
    }
    if (request.emotion !== undefined) {
      // `say` no expone parámetros emocionales. Lo loguemos en debug
      // para que cuando el caller venga buscando "por qué no suena
      // distinto al cambiar emoción", la pista esté ahí.
      this.logger.debug(`emotion='${request.emotion}' ignorada — say no la soporta`);
    }

    const filePath = this.makeTempPath();
    const voice = this.config.voice === '' ? null : this.config.voice;

    try {
      await this.exportToFile(request.text, voice, this.config.speed, filePath);
    } catch (err) {
      throw new SystemTTSError(`SystemTTS: say.export falló — ${describe(err)}`, err);
    }

    let audio: Buffer;
    try {
      audio = await this.readFile(filePath);
    } catch (err) {
      throw new SystemTTSError(`SystemTTS: no se pudo leer el WAV exportado en ${filePath}`, err);
    } finally {
      // Cleanup best-effort: si falla (ya borrado, permisos, etc.) solo
      // loguear. No queremos romper el turno por basura en /tmp.
      this.unlink(filePath).catch((err: unknown) => {
        this.logger.debug(`unlink ${filePath} falló: ${describe(err)}`);
      });
    }

    if (audio.byteLength === 0) {
      throw new SystemTTSError(
        `SystemTTS: el archivo exportado está vacío (${filePath}). ¿Falta festival/espeak en Linux?`,
      );
    }

    return { audio, mimeType: 'audio/wav' };
  }

  /**
   * Envuelve `say.export` (callback-based) en una promesa con timeout.
   * Si el callback no llega en `timeout_ms`, rechaza con un error
   * explícito en lugar de quedar colgada (importante en Linux donde
   * `say` puede fallar silenciosamente si no hay un motor instalado).
   */
  private exportToFile(
    text: string,
    voice: string | null,
    speed: number,
    filePath: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new SystemTTSError(`SystemTTS: timeout tras ${this.config.timeout_ms}ms`));
      }, this.config.timeout_ms);

      this.say.export(text, voice, speed, filePath, (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err !== null && err !== undefined) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
