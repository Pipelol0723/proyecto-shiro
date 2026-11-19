import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../../../src/core/logger.js';
import {
  OllamaLLM,
  OllamaLLMConfigSchema,
  OllamaLLMError,
} from '../../../../src/modules/llm/ollama-llm.js';
import {
  DEFAULT_OLLAMA_KEEP_ALIVE,
  DEFAULT_OLLAMA_NUM_CTX,
} from '../../../../src/modules/llm/ollama-options.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';
import { EventBus } from '../../../../src/core/event-bus.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

/** Stub mínimo de Response — cubre solo lo que `OllamaLLM.generate` lee. */
function mockResponse(
  body: unknown,
  init: { status?: number; statusText?: string; ok?: boolean } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('OllamaLLMConfigSchema', () => {
  it('rechaza config sin model', () => {
    expect(() => OllamaLLMConfigSchema.parse({})).toThrow();
  });

  it('rellena host y temperature con defaults', () => {
    const cfg = OllamaLLMConfigSchema.parse({ model: 'qwen2.5:3b' });
    expect(cfg.host).toBe('http://localhost:11434');
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.timeoutMs).toBe(60_000);
  });

  it('rechaza temperature fuera de [0, 2]', () => {
    expect(() => OllamaLLMConfigSchema.parse({ model: 'x', temperature: 3 })).toThrow();
  });

  it('rechaza host que no es URL válida', () => {
    expect(() => OllamaLLMConfigSchema.parse({ model: 'x', host: 'no-url' })).toThrow();
  });
});

describe('OllamaLLM', () => {
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructor lanza OllamaLLMError con config inválida', () => {
    expect(() => new OllamaLLM({}, makeDeps())).toThrow(OllamaLLMError);
  });

  it('id incluye el nombre del modelo', () => {
    const llm = new OllamaLLM({ model: 'qwen2.5:3b' }, makeDeps());
    expect(llm.id).toBe('llm:ollama:qwen2.5:3b');
  });

  it('generate llama al endpoint /api/chat con el body esperado', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"text":"hola","emotion":"divertida"}' },
        done: true,
        eval_count: 42,
      }),
    );

    const llm = new OllamaLLM({ model: 'qwen2.5:3b', host: 'http://x:1234' }, makeDeps());
    await llm.generate({ text: 'hola Shiro', systemPrompt: 'Eres Shiro.' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://x:1234/api/chat');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.model).toBe('qwen2.5:3b');
    expect(body.stream).toBe(false);
    expect(body.format).toMatchObject({
      type: 'object',
      required: ['text', 'emotion'],
    });
  });

  it('generate construye messages con system + user cuando hay systemPrompt', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"text":"hi","emotion":"neutral"}' },
        done: true,
      }),
    );

    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    await llm.generate({ text: 'hola', systemPrompt: 'Eres X.' });

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toEqual([
      { role: 'system', content: 'Eres X.' },
      { role: 'user', content: 'hola' },
    ]);
  });

  it('generate omite el system message si no se pasa systemPrompt', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"text":"hi","emotion":"neutral"}' },
        done: true,
      }),
    );

    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    await llm.generate({ text: 'hola' });

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toEqual([{ role: 'user', content: 'hola' }]);
  });

  it('generate añade context como mensaje system adicional', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"text":"hi","emotion":"neutral"}' },
        done: true,
      }),
    );

    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    await llm.generate({
      text: 'hola',
      systemPrompt: 'A',
      context: 'Historial: ayer hablamos de música.',
    });

    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(init?.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[1]?.role).toBe('system');
    expect(body.messages[1]?.content).toContain('ayer hablamos');
  });

  it('generate parsea correctamente una respuesta válida', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"text":"hola tú","emotion":"divertida"}' },
        done: true,
        eval_count: 42,
      }),
    );

    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    const result = await llm.generate({ text: 'hola' });

    expect(result.text).toBe('hola tú');
    expect(result.emotion).toBe('divertida');
    expect(result.tokensUsed).toBe(42);
  });

  it('generate degrada a neutral si content no es JSON', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: 'esto no es JSON' },
        done: true,
      }),
    );

    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    const result = await llm.generate({ text: 'hola' });

    expect(result.text).toBe('esto no es JSON');
    expect(result.emotion).toBe('neutral');
  });

  it('generate degrada a neutral si la emoción es desconocida', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"text":"hi","emotion":"euforia"}' },
        done: true,
      }),
    );

    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    const result = await llm.generate({ text: 'hola' });

    expect(result.text).toBe('hi');
    expect(result.emotion).toBe('neutral');
  });

  it('generate lanza OllamaLLMError si fetch rechaza', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    await expect(llm.generate({ text: 'hola' })).rejects.toBeInstanceOf(OllamaLLMError);
  });

  it('generate lanza OllamaLLMError con 5xx', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(
        { error: 'model not found' },
        { ok: false, status: 500, statusText: 'Server Error' },
      ),
    );
    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    await expect(llm.generate({ text: 'hola' })).rejects.toBeInstanceOf(OllamaLLMError);
  });

  it('con una respuesta que no es 2xx, el error lleva el status', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(
        { error: "model 'm' not found" },
        { ok: false, status: 404, statusText: 'Not Found' },
      ),
    );
    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    await expect(llm.generate({ text: 'hola' })).rejects.toMatchObject({ status: 404 });
  });

  it('generate lanza si la respuesta no tiene el shape esperado', async () => {
    fetchSpy.mockResolvedValue(mockResponse({ unexpected: 'shape' }));
    const llm = new OllamaLLM({ model: 'm' }, makeDeps());
    await expect(llm.generate({ text: 'hola' })).rejects.toBeInstanceOf(OllamaLLMError);
  });
});

// P-16, R-141: sin `keep_alive`, Ollama descarga el modelo a los 5 minutos y
// el siguiente turno paga la carga. Sin `num_ctx` explícito, cada llamada con
// otro tamaño de contexto recarga el modelo.
describe('OllamaLLM — opciones de Ollama (P-16)', () => {
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface SentBody {
    keep_alive?: unknown;
    options: { temperature?: number; num_ctx?: number; num_predict?: number };
  }

  async function sentBody(config: Record<string, unknown>): Promise<SentBody> {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"text":"hi","emotion":"neutral"}' },
        done: true,
      }),
    );
    await new OllamaLLM({ model: 'm', ...config }, makeDeps()).generate({ text: 'hola' });
    const [, init] = fetchSpy.mock.calls[0]!;
    return JSON.parse(init?.body as string) as SentBody;
  }

  it('pide a Ollama que mantenga el modelo cargado y fija contexto y longitud', async () => {
    const body = await sentBody({});

    expect(body.keep_alive).toBe(DEFAULT_OLLAMA_KEEP_ALIVE);
    expect(body.options.num_ctx).toBe(DEFAULT_OLLAMA_NUM_CTX);
    expect(body.options.num_predict).toBe(1024);
    expect(body.options.temperature).toBe(0.7);
  });

  it('las tres se pueden cambiar por configuración', async () => {
    const body = await sentBody({ keepAlive: '5m', numCtx: 8192, numPredict: 256 });

    expect(body.keep_alive).toBe('5m');
    expect(body.options.num_ctx).toBe(8192);
    expect(body.options.num_predict).toBe(256);
  });

  it('una respuesta cortada por la longitud entrega el texto que llegó, no el JSON a medias', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: {
          role: 'assistant',
          content: '{"text":"Había una vez una \\"historia\\" muy larga que no',
        },
        done: true,
        done_reason: 'length',
      }),
    );

    const result = await new OllamaLLM({ model: 'm' }, makeDeps()).generate({ text: 'cuenta' });

    expect(result.text).toBe('Había una vez una "historia" muy larga que no…');
    expect(result.emotion).toBe('neutral');
  });

  it('una respuesta cortada antes de llegar al texto no entrega el JSON crudo', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: '{"emotion":"happy","te' },
        done: true,
        done_reason: 'length',
      }),
    );

    await expect(
      new OllamaLLM({ model: 'm' }, makeDeps()).generate({ text: 'cuenta' }),
    ).rejects.toThrow(/cortada/);
  });
});
