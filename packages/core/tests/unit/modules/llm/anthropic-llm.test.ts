import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import {
  AnthropicLLM,
  AnthropicLLMConfigSchema,
  AnthropicLLMError,
} from '../../../../src/modules/llm/anthropic-llm.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

/**
 * Mock parcial del cliente del SDK. Solo simulamos `messages.create`
 * que es lo único que AnthropicLLM invoca.
 */
function makeMockClient(mockCreate: ReturnType<typeof vi.fn>): Anthropic {
  return {
    messages: { create: mockCreate },
  } as unknown as Anthropic;
}

/** Builder de un `Anthropic.Message` mínimo válido. */
function makeMockMessage(
  content: Anthropic.Message['content'],
  usage = { input_tokens: 10, output_tokens: 20 },
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { ...usage, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  } as unknown as Anthropic.Message;
}

describe('AnthropicLLMConfigSchema', () => {
  it('rellena defaults razonables', () => {
    const cfg = AnthropicLLMConfigSchema.parse({});
    expect(cfg.model).toBe('claude-sonnet-4-6');
    expect(cfg.max_tokens).toBe(1024);
    expect(cfg.temperature).toBe(1.0);
  });

  it('acepta overrides explícitos', () => {
    const cfg = AnthropicLLMConfigSchema.parse({
      model: 'claude-opus-4-1',
      max_tokens: 2048,
      temperature: 0.3,
    });
    expect(cfg.model).toBe('claude-opus-4-1');
    expect(cfg.max_tokens).toBe(2048);
    expect(cfg.temperature).toBe(0.3);
  });

  it('rechaza temperature fuera de [0, 1]', () => {
    expect(() => AnthropicLLMConfigSchema.parse({ temperature: 1.5 })).toThrow();
    expect(() => AnthropicLLMConfigSchema.parse({ temperature: -0.1 })).toThrow();
  });

  it('rechaza max_tokens no positivo', () => {
    expect(() => AnthropicLLMConfigSchema.parse({ max_tokens: 0 })).toThrow();
    expect(() => AnthropicLLMConfigSchema.parse({ max_tokens: -1 })).toThrow();
  });
});

describe('AnthropicLLM', () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockClient: Anthropic;

  beforeEach(() => {
    mockCreate = vi.fn();
    mockClient = makeMockClient(mockCreate);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('id incluye el modelo', () => {
    const llm = new AnthropicLLM({ model: 'claude-sonnet-4-6' }, makeDeps(), {
      client: mockClient,
    });
    expect(llm.id).toBe('llm:anthropic:claude-sonnet-4-6');
  });

  it('constructor sin API key no lanza (solo warn) — bootstrap-friendly', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(() => new AnthropicLLM({}, makeDeps())).not.toThrow();
  });

  it('generate lanza si no hay cliente disponible (sin API key)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const llm = new AnthropicLLM({}, makeDeps());
    await expect(llm.generate({ text: 'hola' })).rejects.toBeInstanceOf(AnthropicLLMError);
  });

  it('generate construye el request con tool_choice forzado', async () => {
    mockCreate.mockResolvedValue(
      makeMockMessage([
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'respond',
          input: { text: 'hola', emotion: 'divertida' },
        },
      ]),
    );

    const llm = new AnthropicLLM({ model: 'claude-sonnet-4-6' }, makeDeps(), {
      client: mockClient,
    });
    await llm.generate({ text: 'hola Shiro', systemPrompt: 'Eres Shiro.' });

    expect(mockCreate).toHaveBeenCalledOnce();
    const args = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.model).toBe('claude-sonnet-4-6');
    expect(args.system).toBe('Eres Shiro.');
    expect(args.messages).toEqual([{ role: 'user', content: 'hola Shiro' }]);
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'respond' });
    expect(Array.isArray(args.tools)).toBe(true);
  });

  it('generate omite system si no se pasa systemPrompt', async () => {
    mockCreate.mockResolvedValue(
      makeMockMessage([
        { type: 'tool_use', id: 't', name: 'respond', input: { text: 'hi', emotion: 'neutral' } },
      ]),
    );

    const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
    await llm.generate({ text: 'hola' });

    const args = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.system).toBeUndefined();
  });

  it('generate combina systemPrompt + context en el campo `system`', async () => {
    mockCreate.mockResolvedValue(
      makeMockMessage([
        { type: 'tool_use', id: 't', name: 'respond', input: { text: 'hi', emotion: 'neutral' } },
      ]),
    );

    const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
    await llm.generate({
      text: 'hola',
      systemPrompt: 'Eres Shiro.',
      context: 'Ayer hablamos de música.',
    });

    const args = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.system).toContain('Eres Shiro.');
    expect(args.system).toContain('Ayer hablamos de música.');
  });

  it('generate extrae text + emotion del tool_use block', async () => {
    mockCreate.mockResolvedValue(
      makeMockMessage(
        [
          {
            type: 'tool_use',
            id: 't',
            name: 'respond',
            input: { text: 'hola tú', emotion: 'divertida' },
          },
        ],
        { input_tokens: 50, output_tokens: 30 },
      ),
    );

    const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
    const result = await llm.generate({ text: 'hola' });

    expect(result.text).toBe('hola tú');
    expect(result.emotion).toBe('divertida');
    expect(result.tokensUsed).toBe(80);
  });

  it('generate degrada a neutral si la emoción del tool_use no está en el enum', async () => {
    mockCreate.mockResolvedValue(
      makeMockMessage([
        {
          type: 'tool_use',
          id: 't',
          name: 'respond',
          input: { text: 'hi', emotion: 'euforia' },
        },
      ]),
    );

    const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
    const result = await llm.generate({ text: 'hola' });

    expect(result.text).toBe('hi');
    expect(result.emotion).toBe('neutral');
  });

  it('generate degrada al text block si no hay tool_use (fallback)', async () => {
    mockCreate.mockResolvedValue(
      makeMockMessage([{ type: 'text', text: 'algo sin formato', citations: null }]),
    );

    const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
    const result = await llm.generate({ text: 'hola' });

    expect(result.text).toBe('algo sin formato');
    expect(result.emotion).toBe('neutral');
  });

  it('generate devuelve text vacío si no hay ningún bloque útil', async () => {
    mockCreate.mockResolvedValue(makeMockMessage([]));

    const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
    const result = await llm.generate({ text: 'hola' });

    expect(result.text).toBe('');
    expect(result.emotion).toBe('neutral');
  });

  it('generate envuelve errores del SDK en AnthropicLLMError', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit'));

    const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
    await expect(llm.generate({ text: 'hola' })).rejects.toBeInstanceOf(AnthropicLLMError);
  });

  describe('generateWithTools (loop tool-use)', () => {
    const toolDef = {
      name: 'fs_read',
      description: 'Lee un archivo',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };

    function toolUse(id: string, name: string, input: Record<string, unknown>): Anthropic.Message {
      return makeMockMessage([
        { type: 'tool_use', id, name, input },
      ] as Anthropic.Message['content']);
    }

    it('ejecuta una tool real y cierra con respond', async () => {
      mockCreate
        .mockResolvedValueOnce(toolUse('tu_1', 'fs_read', { path: 'notas.txt' }))
        .mockResolvedValueOnce(
          toolUse('tu_2', 'respond', { text: 'dice hola', emotion: 'divertida' }),
        );
      const executeTool = vi.fn(() => Promise.resolve({ ok: true, output: 'hola' }));

      const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
      const result = await llm.generateWithTools(
        { text: 'lee notas.txt' },
        { tools: [toolDef], executeTool },
      );

      expect(executeTool).toHaveBeenCalledWith('fs_read', { path: 'notas.txt' });
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('dice hola');
      expect(result.emotion).toBe('divertida');
    });

    it('responde directo (respond) sin usar tools', async () => {
      mockCreate.mockResolvedValueOnce(
        toolUse('tu_1', 'respond', { text: 'hola', emotion: 'neutral' }),
      );
      const executeTool = vi.fn(() => Promise.resolve({ ok: true, output: '' }));

      const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
      const result = await llm.generateWithTools(
        { text: 'hola' },
        { tools: [toolDef], executeTool },
      );

      expect(executeTool).not.toHaveBeenCalled();
      expect(result.text).toBe('hola');
    });

    it('corta en maxRounds si el modelo nunca llama respond', async () => {
      mockCreate.mockResolvedValue(toolUse('tu_x', 'fs_read', { path: 'x' }));
      const executeTool = vi.fn(() => Promise.resolve({ ok: true, output: 'x' }));

      const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
      const result = await llm.generateWithTools(
        { text: 'loop' },
        { tools: [toolDef], executeTool, maxRounds: 2 },
      );

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.text).toContain('no pude completar');
    });

    it('usa options.maxTokens en la llamada al SDK (override del default del chat)', async () => {
      mockCreate.mockResolvedValueOnce(
        toolUse('tu_1', 'respond', { text: 'ok', emotion: 'neutral' }),
      );
      const executeTool = vi.fn(() => Promise.resolve({ ok: true, output: '' }));
      const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
      await llm.generateWithTools(
        { text: 'x' },
        { tools: [toolDef], executeTool, maxTokens: 16_384 },
      );
      expect((mockCreate.mock.calls[0]?.[0] as { max_tokens: number }).max_tokens).toBe(16_384);
    });

    it('sin maxTokens usa el default de la config (1024)', async () => {
      mockCreate.mockResolvedValueOnce(
        toolUse('tu_1', 'respond', { text: 'ok', emotion: 'neutral' }),
      );
      const executeTool = vi.fn(() => Promise.resolve({ ok: true, output: '' }));
      const llm = new AnthropicLLM({}, makeDeps(), { client: mockClient });
      await llm.generateWithTools({ text: 'x' }, { tools: [toolDef], executeTool });
      expect((mockCreate.mock.calls[0]?.[0] as { max_tokens: number }).max_tokens).toBe(1024);
    });
  });
});
