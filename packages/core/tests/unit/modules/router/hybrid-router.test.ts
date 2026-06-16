import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../src/core/event-bus.js';
import { Logger } from '../../../../src/core/logger.js';
import {
  HybridRouter,
  HybridRouterConfigSchema,
  HybridRouterError,
  routeByHeuristic,
  requiresToolsByHeuristic,
} from '../../../../src/modules/router/hybrid-router.js';
import type { ModuleDeps } from '../../../../src/core/module-loader.js';

function makeDeps(): ModuleDeps {
  const logger = new Logger('error', { module: 'test' });
  return { logger, bus: new EventBus({ logger }) };
}

function mockResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response;
}

/** Construye un response Ollama que envuelve un JSON string en `message.content`. */
function classifierResponse(tier: 'local' | 'cloud', requiresTools = false): Response {
  return mockResponse({
    message: {
      role: 'assistant',
      content: JSON.stringify({ tier, requires_tools: requiresTools }),
    },
  });
}

describe('HybridRouterConfigSchema', () => {
  it('rellena defaults razonables', () => {
    const cfg = HybridRouterConfigSchema.parse({});
    expect(cfg.classifier_model).toBe('qwen2.5:3b');
    expect(cfg.classifier_host).toBe('http://localhost:11434');
    expect(cfg.timeout_ms).toBe(2_000);
  });

  it('acepta cloud_threshold (aunque V1 lo ignore)', () => {
    const cfg = HybridRouterConfigSchema.parse({ cloud_threshold: 0.6 });
    expect(cfg.cloud_threshold).toBe(0.6);
  });

  it('rechaza host que no es URL', () => {
    expect(() => HybridRouterConfigSchema.parse({ classifier_host: 'no-url' })).toThrow();
  });

  it('rechaza timeout_ms no positivo', () => {
    expect(() => HybridRouterConfigSchema.parse({ timeout_ms: 0 })).toThrow();
    expect(() => HybridRouterConfigSchema.parse({ timeout_ms: -100 })).toThrow();
  });
});

describe('routeByHeuristic', () => {
  it('texto corto sin keywords complejos → local', () => {
    expect(routeByHeuristic('hola')).toBe('local');
    expect(routeByHeuristic('qué hora es')).toBe('local');
    expect(routeByHeuristic('gracias')).toBe('local');
  });

  it('texto > 200 caracteres → cloud', () => {
    const longText = 'a'.repeat(201);
    expect(routeByHeuristic(longText)).toBe('cloud');
  });

  it('detecta verbos complejos en español', () => {
    expect(routeByHeuristic('explícame los modelos de difusión')).toBe('cloud');
    expect(routeByHeuristic('analiza este código por favor')).toBe('cloud');
    expect(routeByHeuristic('compara React vs Vue')).toBe('cloud');
    expect(routeByHeuristic('diseña una arquitectura para X')).toBe('cloud');
  });

  it('detecta verbos complejos en inglés', () => {
    expect(routeByHeuristic('explain quantum entanglement')).toBe('cloud');
    expect(routeByHeuristic('debug this stack trace')).toBe('cloud');
  });

  it('case-insensitive', () => {
    expect(routeByHeuristic('EXPLICA esto')).toBe('cloud');
    expect(routeByHeuristic('Compara A y B')).toBe('cloud');
  });

  it('fuerza cloud cuando la query pide una acción sobre el sistema (ADR 0022 §5)', () => {
    expect(routeByHeuristic('lee el archivo README')).toBe('cloud');
    expect(routeByHeuristic('ejecuta git status')).toBe('cloud');
    expect(routeByHeuristic('muestra el contenido de notas.txt')).toBe('cloud');
  });
});

describe('requiresToolsByHeuristic', () => {
  it('detecta vocabulario de archivos, rutas y comandos', () => {
    expect(requiresToolsByHeuristic('lee el archivo config')).toBe(true);
    expect(requiresToolsByHeuristic('lista la carpeta de descargas')).toBe(true);
    expect(requiresToolsByHeuristic('ejecuta el comando de build')).toBe(true);
    expect(requiresToolsByHeuristic('haz git commit')).toBe(true);
    expect(requiresToolsByHeuristic('abre notas.md')).toBe(true);
    expect(requiresToolsByHeuristic('cuál es la ruta del proyecto')).toBe(true);
  });

  it('no dispara con charla casual ni razonamiento sin acción', () => {
    expect(requiresToolsByHeuristic('hola, cómo estás')).toBe(false);
    expect(requiresToolsByHeuristic('explícame los modelos de difusión')).toBe(false);
    expect(requiresToolsByHeuristic('qué hora es')).toBe(false);
  });
});

describe('HybridRouter', () => {
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('id es "router:hybrid"', () => {
    const router = new HybridRouter({}, makeDeps());
    expect(router.id).toBe('router:hybrid');
  });

  it('constructor lanza con config inválida', () => {
    expect(() => new HybridRouter({ classifier_host: 'no-url' }, makeDeps())).toThrow(
      HybridRouterError,
    );
  });

  it('route llama al endpoint correcto del clasificador', async () => {
    fetchSpy.mockResolvedValue(classifierResponse('local'));

    const router = new HybridRouter(
      { classifier_host: 'http://x:1234', classifier_model: 'qwen2.5:3b' },
      makeDeps(),
    );
    await router.route({ text: 'hola' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://x:1234/api/chat');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.model).toBe('qwen2.5:3b');
    expect(body.format).toMatchObject({
      type: 'object',
      required: ['tier', 'requires_tools'],
    });
    const options = body.options as Record<string, unknown>;
    expect(options.temperature).toBe(0.1);
  });

  it('route devuelve "local" cuando el clasificador dice local', async () => {
    fetchSpy.mockResolvedValue(classifierResponse('local'));

    const router = new HybridRouter({}, makeDeps());
    const tier = await router.route({ text: 'hola' });
    expect(tier).toBe('local');
  });

  it('route devuelve "cloud" cuando el clasificador dice cloud', async () => {
    fetchSpy.mockResolvedValue(classifierResponse('cloud'));

    const router = new HybridRouter({}, makeDeps());
    const tier = await router.route({ text: 'explica los modelos de difusión' });
    expect(tier).toBe('cloud');
  });

  it('fast-path: query con tool-markers va a cloud SIN consultar al clasificador', async () => {
    fetchSpy.mockResolvedValue(classifierResponse('local'));

    const router = new HybridRouter({}, makeDeps());
    const tier = await router.route({ text: 'lee el archivo README' });

    expect(tier).toBe('cloud');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fuerza cloud cuando el clasificador marca requires_tools (aunque tier sea local)', async () => {
    fetchSpy.mockResolvedValue(classifierResponse('local', true));

    const router = new HybridRouter({}, makeDeps());
    // Texto sin tool-markers explícitos → llega al clasificador, que lo marca.
    const tier = await router.route({ text: 'necesito que prepares mi entorno' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(tier).toBe('cloud');
  });

  it('respeta el tier del clasificador cuando requires_tools es false', async () => {
    fetchSpy.mockResolvedValue(classifierResponse('local', false));

    const router = new HybridRouter({}, makeDeps());
    expect(await router.route({ text: 'cuéntame un chiste' })).toBe('local');
  });

  it('tolera un clasificador que omite requires_tools (default false)', async () => {
    // Shape "viejo" sin el campo requires_tools.
    fetchSpy.mockResolvedValue(
      mockResponse({ message: { role: 'assistant', content: JSON.stringify({ tier: 'local' }) } }),
    );

    const router = new HybridRouter({}, makeDeps());
    expect(await router.route({ text: 'cuéntame un chiste' })).toBe('local');
  });

  it('route cae a heurística cuando fetch rechaza', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const router = new HybridRouter({}, makeDeps());
    // Texto corto sin complejidad → heurística devuelve local.
    expect(await router.route({ text: 'hola' })).toBe('local');
    // Texto largo → heurística devuelve cloud.
    expect(await router.route({ text: 'x'.repeat(250) })).toBe('cloud');
  });

  it('route cae a heurística cuando el clasificador devuelve 5xx', async () => {
    fetchSpy.mockResolvedValue(mockResponse({ error: 'down' }, { ok: false, status: 503 }));

    const router = new HybridRouter({}, makeDeps());
    expect(await router.route({ text: 'analiza esto' })).toBe('cloud'); // por heurística
  });

  it('route cae a heurística cuando el response no tiene la forma esperada', async () => {
    fetchSpy.mockResolvedValue(mockResponse({ totally: 'wrong' }));

    const router = new HybridRouter({}, makeDeps());
    expect(await router.route({ text: 'hola' })).toBe('local');
  });

  it('route cae a heurística cuando el content no es JSON parseable', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({ message: { role: 'assistant', content: 'esto no es JSON' } }),
    );

    const router = new HybridRouter({}, makeDeps());
    expect(await router.route({ text: 'hola' })).toBe('local');
  });

  it('route cae a heurística cuando el tier no está en el enum', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({
        message: { role: 'assistant', content: JSON.stringify({ tier: 'edge' }) },
      }),
    );

    const router = new HybridRouter({}, makeDeps());
    // Heurística sobre 'hola' → 'local'.
    expect(await router.route({ text: 'hola' })).toBe('local');
  });
});
