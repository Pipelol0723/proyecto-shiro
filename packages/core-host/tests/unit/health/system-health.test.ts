/**
 * Tests de system-health — el chequeo server-side de servicios + keys.
 *
 * `fetch` se inyecta (no toca red real). Verificamos: el mapeo ok/down
 * por status, la resolución de URLs desde config (con defaults), y la
 * lectura de presencia de keys desde el entorno.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ModulesConfig } from '@proyecto-shiro/core';
import {
  checkSystemHealth,
  readSecretPresence,
  resolveHealthTargets,
} from '../../../src/health/system-health.js';
import { MANAGED_KEYS, SECRET_FIELD_TO_ENV } from '../../../src/secrets/secrets-file.js';

function makeConfig(overrides?: {
  ollamaHost?: string;
  lettaUrl?: string;
  whisperUrl?: string;
  localModel?: string;
  classifierModel?: string;
  embeddingModel?: string;
}): ModulesConfig {
  return {
    version: 1,
    modules: {
      llm: {
        local: {
          active: 'OllamaLLM',
          config: { host: overrides?.ollamaHost, model: overrides?.localModel },
        },
        cloud: { active: 'AnthropicLLM', config: {} },
      },
      router: {
        active: 'HybridRouter',
        config: { classifier_model: overrides?.classifierModel },
      },
      stt: { active: 'WhisperSTT', config: { service_url: overrides?.whisperUrl } },
      tts: { active: 'ElevenLabsTTS', config: {} },
      memory: {
        active: 'MemoryManager',
        config: {
          letta: { base_url: overrides?.lettaUrl, embedding_model: overrides?.embeddingModel },
        },
      },
      avatar: { active: 'Live2DAvatar', config: {} },
      tools: { active: 'ToolsRegistry', config: {} },
    },
    character: { file: 'x.yaml' },
  };
}

/**
 * fetch fake que responde según la URL. En estos tests siempre se invoca
 * con una URL string (lo construye `checkSystemHealth`), así que solo
 * manejamos ese caso.
 */
function makeFetch(byUrl: (url: string) => number | 'reject'): typeof fetch {
  const impl = (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.href;
    const result = byUrl(url);
    if (result === 'reject') return Promise.reject(new Error('network down'));
    const res: Pick<Response, 'ok' | 'status'> = {
      ok: result >= 200 && result < 300,
      status: result,
    };
    return Promise.resolve(res as Response);
  };
  return impl as typeof fetch;
}

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

describe('resolveHealthTargets', () => {
  it('lee las URLs de la config', () => {
    const targets = resolveHealthTargets(
      makeConfig({
        ollamaHost: 'http://ollama:1',
        lettaUrl: 'http://letta:2',
        whisperUrl: 'http://whisper:3',
      }),
    );
    expect(targets).toEqual({
      ollamaUrl: 'http://ollama:1',
      lettaUrl: 'http://letta:2',
      whisperUrl: 'http://whisper:3',
      ollamaModels: [],
    });
  });

  it('reúne, sin repetir, los modelos que Ollama tiene que tener', () => {
    const targets = resolveHealthTargets(
      makeConfig({
        localModel: 'qwen2.5:3b',
        classifierModel: 'qwen2.5:3b',
        embeddingModel: 'mxbai-embed-large',
      }),
    );
    expect(targets.ollamaModels).toEqual(['qwen2.5:3b', 'mxbai-embed-large']);
  });

  it('cae a los defaults cuando la config no trae URLs', () => {
    const targets = resolveHealthTargets(makeConfig());
    expect(targets.ollamaUrl).toBe('http://localhost:11434');
    expect(targets.lettaUrl).toBe('http://localhost:8283');
    expect(targets.whisperUrl).toBe('http://localhost:8765');
  });
});

describe('readSecretPresence', () => {
  it('reporta false cuando las keys no están', () => {
    expect(readSecretPresence()).toEqual({ anthropic: false, elevenlabs: false, gemini: false });
  });

  it('reporta true cuando las keys están (no expone el valor)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    process.env.ELEVENLABS_API_KEY = 'el-xxx';
    process.env.GEMINI_API_KEY = 'gm-xxx';
    expect(readSecretPresence()).toEqual({ anthropic: true, elevenlabs: true, gemini: true });
  });

  it('trata una key vacía / solo espacios como ausente', () => {
    process.env.ANTHROPIC_API_KEY = '   ';
    process.env.ELEVENLABS_API_KEY = '';
    expect(readSecretPresence()).toEqual({ anthropic: false, elevenlabs: false, gemini: false });
  });
});

describe('readSecretPresence y claves gestionadas', () => {
  it('informa true para cada campo de SECRET_FIELD_TO_ENV cuando su clave está definida', () => {
    for (const key of MANAGED_KEYS) process.env[key] = 'x';
    try {
      const presence = readSecretPresence() as Record<string, boolean>;
      for (const field of Object.keys(SECRET_FIELD_TO_ENV)) expect(presence[field]).toBe(true);
    } finally {
      for (const key of MANAGED_KEYS) delete process.env[key];
    }
  });
});

describe('readSecretPresence con Gemini', () => {
  it('readSecretPresence informa gemini (true/false)', () => {
    expect(readSecretPresence().gemini).toBe(false);
    process.env.GEMINI_API_KEY = 'gm-xxx';
    expect(readSecretPresence().gemini).toBe(true);
    process.env.GEMINI_API_KEY = '  ';
    expect(readSecretPresence().gemini).toBe(false);
  });
});

describe('checkSystemHealth', () => {
  const targets = {
    ollamaUrl: 'http://localhost:11434',
    lettaUrl: 'http://localhost:8283',
    whisperUrl: 'http://localhost:8765',
  };

  it('marca ok los servicios que responden 2xx', async () => {
    const report = await checkSystemHealth({ ...targets, fetchImpl: makeFetch(() => 200) });
    expect(report.services).toEqual({ ollama: 'ok', letta: 'ok', whisper: 'ok' });
    expect(typeof report.checkedAt).toBe('string');
  });

  it('marca down los servicios que devuelven no-2xx o rechazan', async () => {
    const report = await checkSystemHealth({
      ...targets,
      fetchImpl: makeFetch((url) => {
        if (url.includes('11434')) return 200; // ollama ok
        if (url.includes('8283')) return 500; // letta error
        return 'reject'; // whisper sin red
      }),
    });
    expect(report.services).toEqual({ ollama: 'ok', letta: 'down', whisper: 'down' });
  });

  it('pega el path correcto a cada servicio', async () => {
    const seen: string[] = [];
    await checkSystemHealth({
      ...targets,
      fetchImpl: makeFetch((url) => {
        seen.push(url);
        return 200;
      }),
    });
    expect(seen).toContain('http://localhost:11434/api/tags');
    expect(seen).toContain('http://localhost:8283/v1/health/');
    expect(seen).toContain('http://localhost:8765/health');
  });

  it('incluye la presencia de keys en el reporte', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const report = await checkSystemHealth({ ...targets, fetchImpl: makeFetch(() => 200) });
    expect(report.secrets).toEqual({ anthropic: true, elevenlabs: false, gemini: false });
  });

  it('un servicio caído no tumba a los otros (Promise.all resiliente)', async () => {
    const report = await checkSystemHealth({
      ...targets,
      fetchImpl: makeFetch((url) => (url.includes('8283') ? 'reject' : 200)),
    });
    expect(report.services.ollama).toBe('ok');
    expect(report.services.whisper).toBe('ok');
    expect(report.services.letta).toBe('down');
  });

  it('incluye geminiVoice cuando se le pasa', async () => {
    const geminiVoice = {
      status: 'expiring',
      expiresAt: '2026-12-01T00:00:00.000Z',
      daysLeft: 17,
    } as const;
    const report = await checkSystemHealth({
      ...targets,
      geminiVoice,
      fetchImpl: makeFetch(() => 200),
    });
    expect(report.geminiVoice).toEqual(geminiVoice);
  });

  it('omite geminiVoice cuando no hay estado', async () => {
    const report = await checkSystemHealth({ ...targets, fetchImpl: makeFetch(() => 200) });
    expect('geminiVoice' in report).toBe(false);
  });
});

describe('checkSystemHealth — vivo frente a listo', () => {
  const targets = {
    ollamaUrl: 'http://localhost:11434',
    lettaUrl: 'http://localhost:8283',
    whisperUrl: 'http://localhost:8765',
    ollamaModels: ['qwen2.5:3b', 'mxbai-embed-large'],
  };

  /** fetch fake con cuerpo JSON por servicio; `undefined` = responde sin cuerpo legible. */
  function makeJsonFetch(bodies: { ollama?: unknown; whisper?: unknown }): typeof fetch {
    const impl = (input: string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.href;
      const isOllama = url.includes('11434');
      const isWhisper = url.includes('8765');
      const body = isOllama ? bodies.ollama : isWhisper ? bodies.whisper : {};
      const res = {
        ok: true,
        status: 200,
        json: () =>
          body === undefined ? Promise.reject(new Error('no es JSON')) : Promise.resolve(body),
      };
      return Promise.resolve(res as Response);
    };
    return impl as typeof fetch;
  }

  const allModels = { models: [{ name: 'qwen2.5:3b' }, { name: 'mxbai-embed-large:latest' }] };
  const whisperGpu = { status: 'ok', model: 'small', device: 'cuda' };

  it('con todo listo, el informe no trae readiness', async () => {
    const report = await checkSystemHealth({
      ...targets,
      fetchImpl: makeJsonFetch({ ollama: allModels, whisper: whisperGpu }),
    });
    expect(report.services).toEqual({ ollama: 'ok', letta: 'ok', whisper: 'ok' });
    expect(report.readiness).toBeUndefined();
  });

  it('Ollama responde pero le falta un modelo: sigue vivo y dice cuál', async () => {
    const report = await checkSystemHealth({
      ...targets,
      fetchImpl: makeJsonFetch({
        ollama: { models: [{ name: 'mxbai-embed-large:latest' }, { name: 'llama3:8b' }] },
        whisper: whisperGpu,
      }),
    });
    expect(report.services.ollama).toBe('ok');
    expect(report.readiness).toEqual({ ollamaMissingModels: ['qwen2.5:3b'] });
  });

  it('un modelo sin etiqueta vale con su «:latest»; uno con etiqueta no vale con otra', async () => {
    const report = await checkSystemHealth({
      ...targets,
      fetchImpl: makeJsonFetch({
        ollama: { models: [{ name: 'mxbai-embed-large:latest' }, { name: 'qwen2.5:7b' }] },
        whisper: whisperGpu,
      }),
    });
    expect(report.readiness?.ollamaMissingModels).toEqual(['qwen2.5:3b']);
  });

  it('si la lista de Ollama no se puede leer, no se inventa que falten modelos', async () => {
    const unreadable = await checkSystemHealth({
      ...targets,
      fetchImpl: makeJsonFetch({ ollama: undefined, whisper: whisperGpu }),
    });
    const odd = await checkSystemHealth({
      ...targets,
      fetchImpl: makeJsonFetch({ ollama: { models: 'raro' }, whisper: whisperGpu }),
    });
    expect(unreadable.services.ollama).toBe('ok');
    expect(unreadable.readiness).toBeUndefined();
    expect(odd.readiness).toBeUndefined();
  });

  it('Whisper cargando el modelo: vivo pero no listo', async () => {
    const report = await checkSystemHealth({
      ...targets,
      fetchImpl: makeJsonFetch({ ollama: allModels, whisper: { status: 'loading' } }),
    });
    expect(report.services.whisper).toBe('ok');
    expect(report.readiness).toEqual({ whisper: 'loading' });
  });

  it('Whisper en CPU se avisa', async () => {
    const report = await checkSystemHealth({
      ...targets,
      fetchImpl: makeJsonFetch({
        ollama: allModels,
        whisper: { status: 'ok', model: 'small', device: 'cpu' },
      }),
    });
    expect(report.readiness).toEqual({ whisper: 'cpu' });
  });

  it('un servicio caído no lleva readiness', async () => {
    const down = (input: string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.href;
      return url.includes('8283')
        ? Promise.resolve({ ok: true, status: 200 } as Response)
        : Promise.reject(new Error('network down'));
    };
    const report = await checkSystemHealth({ ...targets, fetchImpl: down as typeof fetch });
    expect(report.services).toEqual({ ollama: 'down', letta: 'ok', whisper: 'down' });
    expect(report.readiness).toBeUndefined();
  });
});
