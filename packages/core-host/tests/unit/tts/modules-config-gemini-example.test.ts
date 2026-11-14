/**
 * El bloque COMENTADO de `config/modules.config.yaml` (cadena Gemini →
 * ElevenLabs → SystemTTS, ADR 0034 §3) debe ser aceptado de verdad por el
 * cargador de configuración y por `buildTtsChain`: así, al activar el nivel
 * de pago, basta con descomentarlo. El test hace esa operación en una copia
 * temporal fuera del repo, sin red y con módulos falsos que validan su
 * configuración con los esquemas reales.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ElevenLabsTTSConfigSchema,
  EventBus,
  GeminiTTSConfigSchema,
  Logger,
  ModuleLoader,
} from '@proyecto-shiro/core';
import type { EventMap, ITTSModule } from '@proyecto-shiro/core';
import { ConfigLoader } from '@proyecto-shiro/core/node';
import { buildTtsChain } from '../../../src/tts/build-tts-chain.js';

const REAL_CONFIG = fileURLToPath(
  new URL('../../../../../config/modules.config.yaml', import.meta.url),
);
const BEGIN = '# EJEMPLO-GEMINI-INICIO';
const END = '# EJEMPLO-GEMINI-FIN';

/** Devuelve el YAML con el slot `tts` activo sustituido por el ejemplo descomentado. */
function withExampleUncommented(text: string): string {
  const lines = text.split(/\r?\n/);
  const begin = lines.findIndex((l) => l.trim() === BEGIN);
  const end = lines.findIndex((l) => l.trim() === END);
  const tts = lines.findIndex((l) => l === '  tts:');
  if (begin < 0 || end < begin || tts < 0 || tts > begin) {
    throw new Error('Faltan los marcadores del ejemplo de Gemini en modules.config.yaml');
  }
  const example = lines.slice(begin + 1, end).map((l) => l.replace(/^(\s*)# ?/, '$1'));
  return [...lines.slice(0, tts), ...example, ...lines.slice(end + 1)].join('\n');
}

const dir = mkdtempSync(join(tmpdir(), 'shiro-cfg-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('ejemplo comentado de la cadena Gemini en modules.config.yaml', () => {
  it('descomentado lo acepta el cargador y buildTtsChain arma GeminiTTS → ElevenLabsTTS → SystemTTS', () => {
    const copy = join(dir, 'modules.config.yaml');
    writeFileSync(copy, withExampleUncommented(readFileSync(REAL_CONFIG, 'utf8')), 'utf8');

    const logger = new Logger('error', { module: 'test' });
    const config = new ConfigLoader({ logger }).loadModulesConfig(copy);
    const slot = config.modules.tts;
    expect(slot.active).toBe('GeminiTTS');
    expect(slot.fallback_chain).toEqual(['ElevenLabsTTS', 'SystemTTS']);

    const loader = new ModuleLoader({ logger });
    const seen: Record<string, { voice_id: string }> = {};
    const fake = (name: string, parse: (c: unknown) => { voice_id: string }) =>
      loader.register(name, (cfg) => {
        seen[name] = parse(cfg);
        return { id: `tts:${name}`, synthesize: () => Promise.reject(new Error('sin red')) };
      });
    fake('GeminiTTS', (c) => GeminiTTSConfigSchema.parse(c));
    fake('ElevenLabsTTS', (c) => ElevenLabsTTSConfigSchema.parse(c));
    loader.register('SystemTTS', () => ({ id: 'tts:SystemTTS' }) as unknown as ITTSModule);

    const bus = new EventBus<EventMap>({ logger });
    const deps = { logger, bus };
    const primary = loader.load<ITTSModule>('GeminiTTS', slot.config ?? {}, deps);
    const chain = buildTtsChain({ primary, slot, loader, deps, logger });

    expect(chain.id).toBe('tts:chain:tts:GeminiTTS→tts:ElevenLabsTTS→tts:SystemTTS');
    // Sin voice_id un eslabón queda mudo: el ejemplo debe traerlo en ambos.
    expect(seen.GeminiTTS?.voice_id).not.toBe('');
    expect(seen.ElevenLabsTTS?.voice_id).not.toBe('');
  });

  it('el YAML real mantiene ElevenLabsTTS como activo', () => {
    const logger = new Logger('error', { module: 'test' });
    const config = new ConfigLoader({ logger }).loadModulesConfig(REAL_CONFIG);
    expect(config.modules.tts.active).toBe('ElevenLabsTTS');
  });
});
