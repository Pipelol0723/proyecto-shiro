/**
 * Tests de secrets-file — persistencia de API keys del binario.
 *
 * Cada test usa un dir temporal propio. Verifica el round-trip
 * load/save, el merge, el borrado con string vacío, el respeto a las env
 * vars ya definidas, y que solo se gestionan las MANAGED_KEYS.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadSecretsEnv,
  saveSecretsEnv,
  SECRETS_FILENAME,
} from '../../../src/secrets/secrets-file.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shiro-secrets-'));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
});

describe('saveSecretsEnv', () => {
  it('escribe el archivo y reporta cambio', () => {
    const changed = saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'sk-ant-xxx' });
    expect(changed).toBe(true);
    const content = readFileSync(join(dir, SECRETS_FILENAME), 'utf8');
    expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-xxx');
    expect(content).not.toContain('ELEVENLABS_API_KEY');
  });

  it('hace merge sin pisar la otra key', () => {
    saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'a1' });
    saveSecretsEnv(dir, { ELEVENLABS_API_KEY: 'e1' });
    const content = readFileSync(join(dir, SECRETS_FILENAME), 'utf8');
    expect(content).toContain('ANTHROPIC_API_KEY=a1');
    expect(content).toContain('ELEVENLABS_API_KEY=e1');
  });

  it('un string vacío borra esa key', () => {
    saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'a1', ELEVENLABS_API_KEY: 'e1' });
    const changed = saveSecretsEnv(dir, { ANTHROPIC_API_KEY: '' });
    expect(changed).toBe(true);
    const content = readFileSync(join(dir, SECRETS_FILENAME), 'utf8');
    expect(content).not.toContain('ANTHROPIC_API_KEY');
    expect(content).toContain('ELEVENLABS_API_KEY=e1');
  });

  it('guardar el mismo valor no reporta cambio', () => {
    saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'a1' });
    const changed = saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'a1' });
    expect(changed).toBe(false);
  });

  it('un update undefined deja la key como estaba', () => {
    saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'a1' });
    const changed = saveSecretsEnv(dir, { ELEVENLABS_API_KEY: undefined });
    expect(changed).toBe(false);
    expect(readFileSync(join(dir, SECRETS_FILENAME), 'utf8')).toContain('ANTHROPIC_API_KEY=a1');
  });
});

describe('loadSecretsEnv', () => {
  it('no-op (devuelve []) si el archivo no existe', () => {
    expect(loadSecretsEnv(dir)).toEqual([]);
    expect(existsSync(join(dir, SECRETS_FILENAME))).toBe(false);
  });

  it('carga las keys en process.env y devuelve sus nombres', () => {
    saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'a1', ELEVENLABS_API_KEY: 'e1' });
    const loaded = loadSecretsEnv(dir);
    expect(loaded).toEqual(['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY']);
    expect(process.env.ANTHROPIC_API_KEY).toBe('a1');
    expect(process.env.ELEVENLABS_API_KEY).toBe('e1');
  });

  it('NO sobrescribe una key ya definida en el entorno', () => {
    process.env.ANTHROPIC_API_KEY = 'from-real-env';
    saveSecretsEnv(dir, { ANTHROPIC_API_KEY: 'from-file' });
    const loaded = loadSecretsEnv(dir);
    expect(loaded).toEqual([]); // no cargó nada (ya estaba)
    expect(process.env.ANTHROPIC_API_KEY).toBe('from-real-env');
  });

  it('ignora líneas no gestionadas / comentarios / basura', () => {
    writeFileSync(
      join(dir, SECRETS_FILENAME),
      '# comentario\nOTHER_KEY=x\nANTHROPIC_API_KEY=a1\nbasura sin igual\n',
      'utf8',
    );
    const loaded = loadSecretsEnv(dir);
    expect(loaded).toEqual(['ANTHROPIC_API_KEY']);
    expect(process.env.ANTHROPIC_API_KEY).toBe('a1');
    expect(process.env.OTHER_KEY).toBeUndefined();
  });
});
