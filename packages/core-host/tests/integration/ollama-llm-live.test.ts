/**
 * Integration test opt-in contra un Ollama real corriendo en localhost.
 *
 * NO corre en CI. Solo se activa cuando ejecutas:
 *
 *   $env:OLLAMA_INTEGRATION='1'; npm test -- --no-coverage
 *
 * Requiere:
 * - Ollama 0.5+ corriendo en `http://localhost:11434`.
 * - Modelo `qwen2.5:3b` descargado (`ollama pull qwen2.5:3b`).
 *
 * Verifica el camino feliz end-to-end: el modelo recibe el system
 * prompt, devuelve JSON estructurado válido y la emoción cae dentro
 * del enum de `Emotion`.
 */

import { describe, expect, it } from 'vitest';
import { EventBus, Logger, OllamaLLM, isEmotion } from '@proyecto-shiro/core';

const ENABLED = process.env.OLLAMA_INTEGRATION === '1';
const MODEL = process.env.OLLAMA_INTEGRATION_MODEL ?? 'qwen2.5:3b';
const HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

function makeDeps() {
  const logger = new Logger('error', { module: 'live-test' });
  return { logger, bus: new EventBus({ logger }) };
}

// `it.skipIf` salta sin marcarlo como falla — verás "skipped" en el output.
describe('OllamaLLM (live)', () => {
  it.skipIf(!ENABLED)(
    'devuelve un JSON estructurado válido contra un Ollama real',
    async () => {
      const llm = new OllamaLLM({ model: MODEL, host: HOST }, makeDeps());

      const response = await llm.generate({
        text: 'Saluda en una sola frase corta, en español.',
        systemPrompt:
          'Eres Shiro, una AI companion. Respondes siempre en español, en frases cortas.',
      });

      expect(response.text.length).toBeGreaterThan(0);
      expect(isEmotion(response.emotion)).toBe(true);
    },
    30_000, // timeout generoso para el primer load del modelo
  );
});
