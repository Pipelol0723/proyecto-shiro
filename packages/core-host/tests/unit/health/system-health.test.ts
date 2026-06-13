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

function makeConfig(overrides?: {
  ollamaHost?: string;
  lettaUrl?: string;
  whisperUrl?: string;
}): ModulesConfig {
  return {
    version: 1,
    modules: {
      llm: {
        local: { active: 'OllamaLLM', config: { host: overrides?.ollamaHost } },
        cloud: { active: 'AnthropicLLM', config: {} },
      },
      router: { active: 'HybridRouter', config: {} },
      stt: { active: 'WhisperSTT', config: { service_url: overrides?.whisperUrl } },
      tts: { active: 'ElevenLabsTTS', config: {} },
      memory: {
        active: 'MemoryManager',
        config: { letta: { base_url: overrides?.lettaUrl } },
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
    });
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
    expect(readSecretPresence()).toEqual({ anthropic: false, elevenlabs: false });
  });

  it('reporta true cuando las keys están (no expone el valor)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    process.env.ELEVENLABS_API_KEY = 'el-xxx';
    expect(readSecretPresence()).toEqual({ anthropic: true, elevenlabs: true });
  });

  it('trata una key vacía / solo espacios como ausente', () => {
    process.env.ANTHROPIC_API_KEY = '   ';
    process.env.ELEVENLABS_API_KEY = '';
    expect(readSecretPresence()).toEqual({ anthropic: false, elevenlabs: false });
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
    expect(report.secrets).toEqual({ anthropic: true, elevenlabs: false });
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
});
