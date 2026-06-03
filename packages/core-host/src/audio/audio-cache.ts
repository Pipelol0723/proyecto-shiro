/**
 * AudioCache — buffers de audio TTS en memoria con TTL.
 *
 * Cuando el pipeline conversacional pide al TTS un buffer de audio, este
 * cache lo guarda asociado a un `audioId` único y devuelve una URL
 * relativa (`/audio/<audioId>.<ext>`) que el HTTP server del core-host
 * sirve. Tras `ttlMs` el buffer se borra automáticamente.
 *
 * Ver ADR 0020, decisión 3 (server genera, cliente reproduce).
 *
 * Diseño:
 *
 * - **Map en memoria**: V1 simple. Si en el futuro el server se reinicia
 *   antes de que un cliente reproduzca, ese audio se pierde — aceptable.
 * - **TTL automático**: cada entry guarda `expiresAt`; un timer del cache
 *   barre cada `sweepMs` (default 10 s) y elimina expiradas.
 * - **`invalidate(audioId)`**: el handler de `tts:cancel` lo llama para
 *   que cualquier fetch posterior reciba 410. El cliente que ya tenía el
 *   buffer descargado debe parar el audio por su lado.
 *
 * Sin auth: este cache asume entorno local (V1). Cuando llegue multi-
 * device o exposición pública, habrá que firmar/limitar las URLs.
 */

import { randomUUID } from 'node:crypto';

export interface AudioCacheOptions {
  /** TTL por defecto si `put()` no especifica uno. Default 60 s. */
  defaultTtlMs?: number;
  /** Cada cuánto barrer entradas expiradas. Default 10 s. */
  sweepMs?: number;
  /**
   * Generador de id único. Inyectable para tests determinísticos.
   * Default `randomUUID()`.
   */
  generateId?: () => string;
  /** Reloj. Inyectable para tests. Default `Date.now`. */
  now?: () => number;
}

export interface AudioCacheEntry {
  buffer: Buffer;
  mimeType: string;
  expiresAt: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
};

/** Mapea un mimeType a la extensión que el HTTP server espera en la URL. */
export function extFromMimeType(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? 'mp3';
}

export class AudioCache {
  private readonly entries = new Map<string, AudioCacheEntry>();
  private readonly defaultTtlMs: number;
  private readonly sweepMs: number;
  private readonly generateId: () => string;
  private readonly now: () => number;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(options: AudioCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000;
    this.sweepMs = options.sweepMs ?? 10_000;
    this.generateId = options.generateId ?? (() => randomUUID());
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Guarda un buffer y devuelve el `audioId` y la URL relativa que el
   * server expone (`/audio/<id>.<ext>`). El caller construye la URL
   * absoluta añadiendo el origin (`http://host:port`).
   */
  put(buffer: Buffer, mimeType: string, ttlMs?: number): { audioId: string; relativeUrl: string } {
    const audioId = this.generateId();
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.entries.set(audioId, {
      buffer,
      mimeType,
      expiresAt: this.now() + ttl,
    });
    return {
      audioId,
      relativeUrl: `/audio/${audioId}.${extFromMimeType(mimeType)}`,
    };
  }

  /**
   * Devuelve la entry si existe y no ha expirado. Si ha expirado, la
   * elimina y devuelve null. Si no existe, devuelve null.
   */
  get(audioId: string): AudioCacheEntry | null {
    const entry = this.entries.get(audioId);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(audioId);
      return null;
    }
    return entry;
  }

  /** Elimina la entry si existe. Usado por el handler de `tts:cancel`. */
  invalidate(audioId: string): boolean {
    return this.entries.delete(audioId);
  }

  /** Tamaño actual del cache. Útil para tests y métricas. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Arranca el sweep timer que elimina expiradas periódicamente. Idempotente
   * — llamar dos veces sin parar entre medias no apila timers.
   */
  start(): void {
    if (this.sweepTimer !== undefined) return;
    this.sweepTimer = setInterval(() => {
      this.sweep();
    }, this.sweepMs);
    // No bloquees el event loop por mantener vivo el cache.
    this.sweepTimer.unref?.();
  }

  /** Detiene el sweep timer. Necesario en tests/shutdown para no fugar. */
  stop(): void {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  /** Elimina todas las entradas expiradas en una pasada. Pública para tests. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
