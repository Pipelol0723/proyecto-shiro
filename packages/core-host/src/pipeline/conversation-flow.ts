/**
 * Pipeline conversacional real — sustituye al `wireMockConversationFlow`
 * del PR 3 cuando todos los módulos (LLM local, LLM cloud, router) son
 * implementaciones reales.
 *
 * Flujo por turno:
 *   user:message
 *     → router.route() → router:routed
 *     → llm.generate() → llm:responded
 *     → (transitional) tts:audio-ended simulado por duración del texto
 *
 * Cuando llegue el TTS real (hito posterior), el simulado de
 * `tts:audio-ended` se elimina — el módulo TTS lo emitirá cuando
 * termine la reproducción real.
 *
 * Ver [ADR 0016](../../../../docs/adr/0016-pipeline-conversational-wiring.md).
 */

import type { EventMap, IEventBus } from '@proyecto-shiro/core';
import type { LoadedModules } from '@proyecto-shiro/core';
import type { Logger } from '@proyecto-shiro/core';

export interface WireConversationFlowOptions {
  bus: IEventBus<EventMap>;
  modules: LoadedModules;
  /**
   * System prompt pre-construido a partir del personaje. Se reusa
   * turn a turn sin recomputar (lo construye `buildSystemPrompt`
   * en bootstrap).
   */
  systemPrompt: string;
  logger: Logger;
  /**
   * Escala los timers internos del TTS simulado.
   * 1 = duración humana. 0 = inmediato (tests). Default 1.
   */
  simulationSpeed?: number;
}

const FALLBACK_RESPONSE = 'Algo salió mal procesando tu mensaje. ¿Lo intentas de nuevo?';
const MIN_SIMULATED_TTS_MS = 2_200;
const MS_PER_CHARACTER = 45;

/**
 * Suscribe el handler de `user:message` que ejecuta el turno real.
 * Devuelve `unsubscribe` para limpieza en tests y shutdown.
 */
export function wireConversationFlow(options: WireConversationFlowOptions): () => void {
  const { bus, modules, systemPrompt, logger, simulationSpeed = 1 } = options;
  const child = logger.child({ module: 'ConversationFlow' });

  const unsubscribe = bus.on('user:message', async (payload) => {
    const startTime = Date.now();

    try {
      // 1. Router decide el tier.
      const tier = await modules.router.route({
        text: payload.text,
        userId: payload.userId,
      });
      await bus.emit('router:routed', { tier, userId: payload.userId });

      // 2. LLM correspondiente responde.
      const llm = tier === 'local' ? modules.llmLocal : modules.llmCloud;
      const response = await llm.generate({
        text: payload.text,
        systemPrompt,
        userId: payload.userId,
      });

      // 3. Emite la respuesta tipada. `LLMResponse.emotion` es opcional;
      //    si la implementación no la rellena, default a neutral.
      const latencyMs = Date.now() - startTime;
      await bus.emit('llm:responded', {
        text: response.text,
        emotion: response.emotion ?? 'neutral',
        userId: payload.userId,
        tier,
        latencyMs,
      });
      child.debug(`turno completo en ${latencyMs}ms (tier=${tier})`);

      // 4. (Transitional) TTS simulado — hasta que llegue el módulo real.
      simulateTTSEnd(bus, response.text, payload.userId, simulationSpeed);
    } catch (err) {
      child.error('error procesando turno, emitiendo fallback', { err });
      const latencyMs = Date.now() - startTime;
      await bus.emit('llm:responded', {
        text: FALLBACK_RESPONSE,
        emotion: 'neutral',
        userId: payload.userId,
        tier: 'local',
        latencyMs,
      });
      simulateTTSEnd(bus, FALLBACK_RESPONSE, payload.userId, simulationSpeed);
    }
  });

  return unsubscribe;
}

/**
 * Emite `tts:audio-ended` tras un delay proporcional al largo del
 * texto, simulando que el TTS terminó. Cuando llegue el TTS real este
 * helper se elimina y el módulo TTS lo hará al terminar el audio.
 */
function simulateTTSEnd(
  bus: IEventBus<EventMap>,
  text: string,
  userId: string,
  speed: number,
): void {
  const baseMs = Math.max(MIN_SIMULATED_TTS_MS, text.length * MS_PER_CHARACTER);
  const delay = baseMs * speed;
  setTimeout(() => {
    void bus.emit('tts:audio-ended', { userId });
  }, delay);
}
