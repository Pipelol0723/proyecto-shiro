/**
 * La URL de `tts:audio` es relativa (P-14, R-314).
 *
 * Antes el core-host emitía `http://localhost:<puerto>/audio/…`: un cliente en
 * otra máquina recibía una dirección que apuntaba a sí mismo. Ahora emite solo
 * la ruta y cada cliente la resuelve contra el origen de su conexión al bus.
 */

import { describe, expect, it } from 'vitest';
import { EventBus, Logger } from '@proyecto-shiro/core';
import type { EventMap, ITTSModule } from '@proyecto-shiro/core';
import { AudioCache } from '../../../src/audio/audio-cache.js';
import { dispatchTTS } from '../../../src/pipeline/conversation-flow.js';

function makeLogger(): Logger {
  return new Logger('error', { module: 'tts-url-test' });
}

const tts: ITTSModule = {
  id: 'tts:mock',
  synthesize: () => Promise.resolve({ audio: Buffer.from([1, 2, 3]), mimeType: 'audio/mpeg' }),
};

describe('dispatchTTS — URL del audio', () => {
  it('emite la ruta del audio, sin servidor ni puerto', async () => {
    const bus = new EventBus<EventMap>({ logger: makeLogger() });
    const cache = new AudioCache();
    const emitted: EventMap['tts:audio'][] = [];
    bus.on('tts:audio', (payload) => {
      emitted.push(payload);
    });

    await dispatchTTS(bus, tts, cache, 'hola', 'neutral', 'me', 1, makeLogger());
    cache.stop();

    expect(emitted).toHaveLength(1);
    const [audio] = emitted;
    expect(audio?.url).toBe(`/audio/${audio?.audioId ?? ''}.mp3`);
    expect(audio?.url).not.toMatch(/localhost|https?:/);
    expect(audio?.mimeType).toBe('audio/mpeg');
    expect(audio?.userId).toBe('me');
  });
});
