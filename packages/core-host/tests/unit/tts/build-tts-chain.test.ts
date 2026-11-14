import { describe, expect, it, vi } from 'vitest';
import { EventBus, Logger, ModuleLoader } from '@proyecto-shiro/core';
import type { EventMap, ITTSModule, ModuleDeps, ModuleSlot } from '@proyecto-shiro/core';
import { buildTtsChain } from '../../../src/tts/build-tts-chain.js';

function makeLogger(): Logger {
  return new Logger('error', { module: 'test' });
}

function makeTts(id: string): ITTSModule {
  return { id, synthesize: vi.fn() };
}

interface Harness {
  loader: ModuleLoader;
  deps: ModuleDeps;
  logger: Logger;
  warn: ReturnType<typeof vi.fn>;
  configs: Map<string, unknown>;
  primary: ITTSModule;
}

/** Loader real con factories falsas que registran la config recibida. */
function makeHarness(names: readonly string[]): Harness {
  const logger = makeLogger();
  const warn = vi.fn();
  logger.warn = warn;
  const loader = new ModuleLoader({ logger });
  const configs = new Map<string, unknown>();
  for (const name of names) {
    loader.register(name, (cfg) => {
      configs.set(name, cfg);
      return makeTts(`tts:${name}`);
    });
  }
  const bus = new EventBus<EventMap>({ logger });
  return { loader, deps: { logger, bus }, logger, warn, configs, primary: makeTts('tts:primary') };
}

function slot(extra: Partial<ModuleSlot> & { active?: string }): ModuleSlot {
  return { active: 'ElevenLabsTTS', ...extra };
}

describe('buildTtsChain', () => {
  const names = ['ElevenLabsTTS', 'GeminiTTS', 'SystemTTS'];

  function build(h: Harness, s: ModuleSlot): ITTSModule {
    return buildTtsChain({
      primary: h.primary,
      slot: s,
      loader: h.loader,
      deps: h.deps,
      logger: h.logger,
    });
  }

  it('añade SystemTTS al final aunque el YAML no lo nombre', () => {
    const h = makeHarness(names);
    const chain = build(h, slot({ fallback_chain: ['GeminiTTS'], providers: { GeminiTTS: {} } }));
    expect(chain.id).toBe('tts:chain:tts:primary→tts:GeminiTTS→tts:SystemTTS');
  });

  it('no duplica SystemTTS si ya está en fallback_chain', () => {
    const h = makeHarness(names);
    const chain = build(h, slot({ fallback_chain: ['SystemTTS'] }));
    expect(chain.id).toBe('tts:chain:tts:primary→tts:SystemTTS');
  });

  it('no añade SystemTTS si es el activo', () => {
    const h = makeHarness(names);
    const chain = build(h, slot({ active: 'SystemTTS', fallback_chain: ['GeminiTTS'] }));
    expect(chain.id).toBe('tts:chain:tts:primary→tts:GeminiTTS');
  });

  it('instancia cada respaldo con providers[nombre]', () => {
    const h = makeHarness(names);
    build(h, slot({ fallback_chain: ['GeminiTTS'], providers: { GeminiTTS: { voice: 'x' } } }));
    expect(h.configs.get('GeminiTTS')).toEqual({ voice: 'x' });
  });

  it('usa {} y avisa si el respaldo no tiene entrada en providers (arranca)', () => {
    const h = makeHarness(names);
    const chain = build(h, slot({ fallback_chain: ['GeminiTTS'] }));
    expect(h.configs.get('GeminiTTS')).toEqual({});
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('GeminiTTS'));
    expect(chain.id).toContain('tts:GeminiTTS');
  });

  it('avisa de una clave de providers que no está en la cadena', () => {
    const h = makeHarness(names);
    build(h, slot({ fallback_chain: ['SystemTTS'], providers: { GeminiTts: { a: 1 } } }));
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('GeminiTts'));
  });

  it('lanza error legible si un nombre no está registrado (contiene el nombre y los registrados)', () => {
    const h = makeHarness(names);
    expect(() => build(h, slot({ fallback_chain: ['GeminiTTs'] }))).toThrow(
      /GeminiTTs.*ElevenLabsTTS, GeminiTTS, SystemTTS/s,
    );
  });

  it('lanza si el nombre repite el activo', () => {
    const h = makeHarness(names);
    expect(() => build(h, slot({ fallback_chain: ['ElevenLabsTTS'] }))).toThrow(/ElevenLabsTTS/);
  });

  it('el id es tts:chain:<activo>→<respaldos>→tts:system', () => {
    const h = makeHarness(['ElevenLabsTTS', 'GeminiTTS', 'SystemTTS']);
    h.loader.register('SystemTTS', () => makeTts('tts:system'));
    const chain = build(h, slot({ fallback_chain: ['GeminiTTS'], providers: { GeminiTTS: {} } }));
    expect(chain.id).toBe('tts:chain:tts:primary→tts:GeminiTTS→tts:system');
  });
});
