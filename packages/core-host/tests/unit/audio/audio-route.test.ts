/**
 * Tests del handler de `/audio`: sirve el audio a quien no manda `Origin`
 * y a los orígenes permitidos (con eco exacto, que el lip-sync necesita), y
 * rechaza los ajenos. Usa un `AudioCache` real y un servidor HTTP efímero.
 */

import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '@proyecto-shiro/core';
import { AudioCache } from '../../../src/audio/audio-cache.js';
import { createAudioRouteHandler } from '../../../src/audio/audio-route.js';

const ALLOWED_ORIGIN = 'http://tauri.localhost';
const AUDIO_BYTES = 'audio-de-prueba';

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

describe('createAudioRouteHandler', () => {
  let server: Server;
  let port: number;
  let audioPath: string;

  beforeEach(async () => {
    const cache = new AudioCache();
    audioPath = cache.put(Buffer.from(AUDIO_BYTES), 'audio/mpeg').relativeUrl;
    const handler = createAudioRouteHandler(cache, new Logger('error'));
    server = createServer((req, res) => {
      if (!handler(req, res)) {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  function get(path: string, origin?: string): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path, headers: origin === undefined ? {} : { Origin: origin } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('sin Origin sirve el audio sin cabecera CORS', async () => {
    const reply = await get(audioPath);
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(AUDIO_BYTES);
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('hace eco del Origin permitido, con Vary: Origin', async () => {
    const reply = await get(audioPath, ALLOWED_ORIGIN);
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(AUDIO_BYTES);
    expect(reply.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(reply.headers.vary).toBe('Origin');
  });

  it('responde 403 a un Origin ajeno, sin audio y sin CORS', async () => {
    const reply = await get(audioPath, 'https://evil.example');
    expect(reply.status).toBe(403);
    expect(reply.body).not.toContain(AUDIO_BYTES);
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('un id desconocido da 410 y tampoco devuelve CORS *', async () => {
    const unknown = '/audio/00000000-0000-0000-0000-000000000000.mp3';
    const plain = await get(unknown);
    expect(plain.status).toBe(410);
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
    const withOrigin = await get(unknown, ALLOWED_ORIGIN);
    expect(withOrigin.status).toBe(410);
    expect(withOrigin.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  it('una ruta que no es /audio no la gestiona', async () => {
    expect((await get('/otra')).status).toBe(404);
  });
});
