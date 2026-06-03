/**
 * Handler HTTP que sirve los buffers del `AudioCache` para que el
 * cliente desktop los reproduzca con `HTMLAudioElement`.
 *
 * Ruta: `GET /audio/<audioId>.<ext>`
 *
 * Comportamiento:
 * - Match → 200 con `Content-Type` del mimeType, `Content-Length`,
 *   `Cache-Control: no-store` (los audios son efímeros, no quiere caché
 *   del browser), y `Access-Control-Allow-Origin: *` (V1 local-only;
 *   ver ADR 0020 para multi-device futuro).
 * - Match con id desconocido o expirado → 410 Gone.
 * - Ruta no-`/audio/...` → devuelve `false` para que el transport
 *   pruebe el siguiente handler o responda 404.
 *
 * No es una clase porque no tiene estado propio — solo cierra sobre
 * el cache y un logger.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@proyecto-shiro/core';
import type { AudioCache } from './audio-cache.js';
import type { HttpRequestHandler } from '../transports/websocket-server-transport.js';

const AUDIO_PATH_RE = /^\/audio\/([\w-]+)\.(?:mp3|wav|ogg)$/;

export function createAudioRouteHandler(
  cache: AudioCache,
  parentLogger: Logger,
): HttpRequestHandler {
  const logger = parentLogger.child({ module: 'AudioRoute' });
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = req.url ?? '';
    const match = AUDIO_PATH_RE.exec(url);
    if (match === null) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end('Method Not Allowed');
      return true;
    }
    const audioId = match[1] ?? '';
    const entry = cache.get(audioId);
    if (entry === null) {
      logger.debug(`audioId ${audioId} no encontrado o expirado`);
      res.statusCode = 410;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end('Gone');
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('Content-Length', String(entry.buffer.byteLength));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(entry.buffer);
    }
    return true;
  };
}
