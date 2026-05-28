import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Logger } from '../../../src/core/logger.js';
import {
  CharacterLoader,
  CharacterValidationError,
} from '../../../src/character/character-loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHARACTER_PATH = join(HERE, '../../../src/character/characters/default.yaml');

const VALID_YAML = `
version: 1
identity:
  name: 'Shiro'
  pronouns: 'ella'
  age_apparent: '~20'
personality:
  traits:
    - curiosa
    - directa
  speech_style: 'natural, frases cortas'
  likes:
    - café
  dislikes:
    - formalismos
backstory: |
  Companion personal.
behaviors:
  greeting_style: 'casual'
  uncertainty_style: 'directo'
  emotional_register:
    casual: 'relajado'
    serio: 'atento'
emotions:
  neutral:
    tts_stability: 0.5
    avatar_expression: 'idle'
`;

function silentLogger(): Logger {
  return new Logger('error');
}

describe('CharacterLoader', () => {
  it('parsea un YAML válido', () => {
    const loader = new CharacterLoader({ logger: silentLogger() });
    const character = loader.loadFromString(VALID_YAML, 'fixture');
    expect(character.identity.name).toBe('Shiro');
    expect(character.personality.traits).toEqual(['curiosa', 'directa']);
    expect(character.behaviors?.emotional_register?.casual).toBe('relajado');
    expect(character.emotions?.neutral?.tts_stability).toBe(0.5);
  });

  it('lanza CharacterValidationError con YAML inválido', () => {
    const loader = new CharacterLoader({ logger: silentLogger() });
    const broken = 'version: 1\nidentity: {}\n';
    expect(() => loader.loadFromString(broken, 'broken')).toThrow(CharacterValidationError);
  });

  it('el error incluye los paths de los campos rotos', () => {
    const loader = new CharacterLoader({ logger: silentLogger() });
    try {
      loader.loadFromString('version: 1\n', 'fix');
      expect.fail('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(CharacterValidationError);
      const msg = (err as CharacterValidationError).message;
      expect(msg).toMatch(/identity/);
      expect(msg).toMatch(/personality/);
    }
  });

  it('lanza si el YAML está vacío', () => {
    const loader = new CharacterLoader({ logger: silentLogger() });
    expect(() => loader.loadFromString('', 'empty')).toThrow(CharacterValidationError);
  });

  it('loadFromFile lee el personaje real del repo', () => {
    const loader = new CharacterLoader({ logger: silentLogger() });
    const character = loader.loadFromFile(DEFAULT_CHARACTER_PATH);
    expect(character.identity.name).toBe('Shiro');
    expect(character.personality.traits.length).toBeGreaterThan(0);
  });
});
