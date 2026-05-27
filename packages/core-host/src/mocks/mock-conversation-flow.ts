/**
 * Simulador del flujo conversacional — server-side.
 *
 * Antes vivía en `packages/desktop/src/screens/Conversation/sample-flow.ts`
 * y se disparaba desde la UI. Ahora vive aquí porque ADR 0012 dice que
 * los módulos LLM/Router/STT/TTS corren server-side. El cliente solo
 * emite `user:message` y consume los eventos que este simulador genera.
 *
 * Esta función se reemplaza pieza a pieza:
 *  - PR 5/6: el "LLM" real (Ollama/Anthropic) sustituye la respuesta canned.
 *  - PR 7: el HybridRouter real sustituye la elección de tier.
 *  - Hitos STT/TTS: módulos reales sustituyen los timers de stt/tts.
 *
 * Mientras tanto, este simulador permite probar end-to-end (cliente ↔
 * server) sin esperar a esos hitos.
 */

import type { EventMap, IEventBus } from '@proyecto-shiro/core';

type Tier = EventMap['router:routed']['tier'];

interface SampleEntry {
  match: RegExp | null;
  response: string;
  emotion: EventMap['llm:responded']['emotion'];
  tier: Tier;
  latencyMs: number;
}

/** Respuestas canned — replican el tono de Shiro definido en el YAML. */
const SAMPLE_REPLIES: readonly SampleEntry[] = [
  {
    match: /(diffusion|difusi[oó]n|modelo|red neuronal)/,
    response:
      'Mmm, déjame pensarlo bien. Imagínate que tomás una imagen y le agregás ruido poco a poco hasta que es pura estática. El modelo aprende a hacer el camino inverso.',
    emotion: 'pensativa',
    tier: 'cloud',
    latencyMs: 1840,
  },
  {
    match: /(record|acord|ayer|mem[oó]ria)/,
    response:
      'Sí, claro. Estábamos viendo cómo estructurar el módulo de memoria. Decidiste empezar con LocalMemory para no depender de Docker desde el día uno.',
    emotion: 'neutral',
    tier: 'local',
    latencyMs: 940,
  },
  {
    match: /(consegu|logr|increib|!)/,
    response: '¿Qué?! Contame contame contame.',
    emotion: 'sorprendida',
    tier: 'local',
    latencyMs: 620,
  },
  {
    match: null, // default
    response:
      '¡Hola! Bien, gracias por preguntar. Acabo de terminar de procesar como tres podcasts de música electrónica que dejaste anoche. Tengo opiniones.',
    emotion: 'alegre',
    tier: 'local',
    latencyMs: 820,
  },
];

function pickReply(input: string): SampleEntry {
  const lower = input.toLowerCase();
  for (const entry of SAMPLE_REPLIES) {
    if (entry.match?.test(lower)) return entry;
  }
  return SAMPLE_REPLIES[SAMPLE_REPLIES.length - 1]!;
}

export interface MockConversationFlowOptions {
  bus: IEventBus<EventMap>;
  /**
   * Escala los timers internos. 1 = velocidad humana. 0 = inmediato
   * (útil en tests). Default 1.
   */
  speed?: number;
}

/**
 * Suscribe al bus para reaccionar a `user:message`. Cuando llega uno,
 * emite la cadena de eventos que simula un turno conversacional
 * completo: router:routed → llm:responded → tts:audio-ended.
 *
 * Devuelve una función `dispose()` para limpiar la suscripción.
 *
 * Importante: este simulador **no emite** los eventos `stt:*` porque
 * en el flujo real esos los emitirá el cliente (cuando se conecte el
 * micrófono real). En el flujo simulado actual, el cliente emite
 * directamente `user:message` desde su input de texto.
 */
export function wireMockConversationFlow(options: MockConversationFlowOptions): () => void {
  const { bus, speed = 1 } = options;

  const wait = (ms: number): Promise<void> =>
    new Promise((res) => {
      setTimeout(res, ms * speed);
    });

  const unsubscribe = bus.on('user:message', async (payload) => {
    const reply = pickReply(payload.text);

    await wait(150);
    await bus.emit('router:routed', { tier: reply.tier, userId: payload.userId });

    await wait(reply.tier === 'cloud' ? 1200 : 500);
    await bus.emit('llm:responded', {
      text: reply.response,
      emotion: reply.emotion,
      userId: payload.userId,
      tier: reply.tier,
      latencyMs: reply.latencyMs,
    });

    // TTS simulado — duración aprox por caracter, con tope mínimo.
    const speakMs = Math.max(2200, reply.response.length * 45);
    await wait(speakMs);
    await bus.emit('tts:audio-ended', { userId: payload.userId });
  });

  return unsubscribe;
}
