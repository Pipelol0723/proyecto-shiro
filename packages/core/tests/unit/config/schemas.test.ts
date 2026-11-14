import { describe, expect, it } from 'vitest';
import { ModulesConfigSchema } from '../../../src/config/schemas.js';

function baseConfig(tts: Record<string, unknown>): unknown {
  const slot = (active: string): Record<string, unknown> => ({ active });
  return {
    version: 1,
    modules: {
      llm: { local: slot('OllamaLLM'), cloud: slot('AnthropicLLM') },
      router: slot('HybridRouter'),
      stt: slot('WhisperSTT'),
      tts,
      memory: slot('MemoryManager'),
      avatar: slot('Live2DAvatar'),
    },
    character: { file: 'config/characters/default.yaml' },
  };
}

describe('ModulesConfigSchema · slot tts', () => {
  it('conserva providers en el slot tts', () => {
    const result = ModulesConfigSchema.safeParse(
      baseConfig({
        active: 'ElevenLabsTTS',
        fallback_chain: ['SystemTTS'],
        providers: { ElevenLabsTTS: { voice_id: 'abc' } },
      }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modules.tts.providers?.ElevenLabsTTS).toEqual({ voice_id: 'abc' });
  });

  it('acepta un slot sin providers', () => {
    const result = ModulesConfigSchema.safeParse(
      baseConfig({ active: 'ElevenLabsTTS', fallback_chain: ['SystemTTS'] }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modules.tts.providers).toBeUndefined();
  });
});
