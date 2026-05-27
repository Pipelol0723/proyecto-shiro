/**
 * Sample flow para la pantalla de conversación.
 *
 * Mientras no hay LLM/STT/TTS reales, esta función simula el ciclo
 * completo emitiendo eventos por el EventBus a tiempos plausibles:
 *
 *   stt:listening → stt:partial × n → stt:transcribed → user:message
 *      → router:routed → llm:responded → tts:audio-ended
 *
 * El reducer del cliente (useCompanionState) reacciona a estos
 * eventos y la UI se anima como si Shiro estuviera operativa.
 *
 * En Fase LLM esto se reemplaza por los módulos reales — pero la
 * misma secuencia de eventos sigue valiendo, así que la UI no cambia.
 */

import type { EventMap, IEventBus } from '@proyecto-shiro/core';

type Tier = EventMap['router:routed']['tier'];

interface SampleEntry {
  userInput: string;
  response: string;
  emotion: EventMap['llm:responded']['emotion'];
  tier: Tier;
  latencyMs: number;
}

/** Respuestas canned — replican el tono de Shiro definido en el YAML. */
export const SAMPLE_REPLIES: readonly SampleEntry[] = [
  {
    userInput: 'Hola Shiro, ¿cómo estás?',
    response:
      '¡Hola! Bien, gracias por preguntar. Acabo de terminar de procesar como tres podcasts de música electrónica que dejaste anoche. Tengo opiniones.',
    emotion: 'alegre',
    tier: 'local',
    latencyMs: 820,
  },
  {
    userInput: 'Explícame cómo funcionan los modelos de difusión',
    response:
      'Mmm, déjame pensarlo bien. Imagínate que tomás una imagen y le agregás ruido poco a poco hasta que es pura estática. El modelo aprende a hacer el camino inverso.',
    emotion: 'pensativa',
    tier: 'cloud',
    latencyMs: 1840,
  },
  {
    userInput: '¿Te acordás de lo que hablamos ayer?',
    response:
      'Sí, claro. Estábamos viendo cómo estructurar el módulo de memoria. Decidiste empezar con LocalMemory para no depender de Docker desde el día uno.',
    emotion: 'neutral',
    tier: 'local',
    latencyMs: 940,
  },
  {
    userInput: '¡Mirá lo que conseguí!',
    response: '¿Qué?! Contame contame contame.',
    emotion: 'sorprendida',
    tier: 'local',
    latencyMs: 620,
  },
] as const;

/** Heurística simple para elegir una respuesta según el input del usuario. */
function pickReply(input: string): SampleEntry {
  const lower = input.toLowerCase();
  if (/(diffusion|difusi[oó]n|modelo|red neuronal)/.test(lower)) {
    return SAMPLE_REPLIES[1]!;
  }
  if (/(record|acord|ayer|mem[oó]ria)/.test(lower)) {
    return SAMPLE_REPLIES[2]!;
  }
  if (/(consegu|logr|increib|!)/.test(lower)) {
    return SAMPLE_REPLIES[3]!;
  }
  return SAMPLE_REPLIES[0]!;
}

export interface RunSampleFlowOptions {
  bus: IEventBus<EventMap>;
  userId: string;
  /** Si se omite, se elige una respuesta basada en `userInput`. */
  userInput?: string;
  /** Para tests — escala los timers. 0 = inmediato. Default 1. */
  speed?: number;
}

/**
 * Ejecuta el flujo completo simulado. Devuelve una promesa que resuelve
 * cuando termina el ciclo (TTS audio-ended emitido).
 *
 * Si no se pasa `userInput`, usa el primero del SAMPLE_REPLIES — sirve
 * para demos rápidas (botón "Probar").
 */
export async function runSampleFlow(options: RunSampleFlowOptions): Promise<void> {
  const { bus, userId, speed = 1 } = options;
  const reply = options.userInput !== undefined ? pickReply(options.userInput) : SAMPLE_REPLIES[0]!;
  const inputText = options.userInput ?? reply.userInput;

  const wait = (ms: number): Promise<void> =>
    new Promise((res) => {
      setTimeout(res, ms * speed);
    });

  // STT: empieza a escuchar.
  await bus.emit('stt:listening', { userId });

  // Emite chunks parciales palabra por palabra para simular dictado.
  const words = inputText.split(' ');
  for (let i = 1; i <= words.length; i += 1) {
    const partial = words.slice(0, i).join(' ');
    await wait(80);
    await bus.emit('stt:partial', { text: partial, userId });
  }

  // STT final.
  await wait(150);
  await bus.emit('stt:transcribed', { text: inputText, userId, isFinal: true });

  // El cliente emite user:message (lo que harían los STT reales o el input de texto).
  await bus.emit('user:message', { text: inputText, userId });

  // Router clasifica.
  await wait(150);
  await bus.emit('router:routed', { tier: reply.tier, userId });

  // LLM piensa.
  await wait(reply.tier === 'cloud' ? 1200 : 500);

  // LLM responde.
  await bus.emit('llm:responded', {
    text: reply.response,
    emotion: reply.emotion,
    userId,
    tier: reply.tier,
    latencyMs: reply.latencyMs,
  });

  // TTS simulado — duración aprox por caracter.
  const speakMs = Math.max(2200, reply.response.length * 45);
  await wait(speakMs);

  await bus.emit('tts:audio-ended', { userId });
}
