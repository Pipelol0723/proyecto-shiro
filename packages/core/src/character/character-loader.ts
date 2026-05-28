/**
 * CharacterLoader — lee un archivo YAML de personaje del disco y lo
 * valida con zod. Mismo patrón que `ConfigLoader` (ver ADR 0006).
 *
 * Node-only — exportado desde `@proyecto-shiro/core/node`. El cliente
 * browser no debe importar de aquí (arrastraría `node:fs` al bundle).
 *
 * Patrón de uso típico (server-side, en bootstrap):
 *
 *   const loader = new CharacterLoader({ logger });
 *   const character = loader.loadFromFile('packages/core/src/character/characters/default.yaml');
 *   const systemPrompt = buildSystemPrompt(character);
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import type { Logger } from '../core/logger.js';
import { type Character, CharacterSchema } from './schema.js';

/**
 * Error de validación del archivo de personaje. Encapsula los issues
 * de zod con sus paths para que el caller pueda presentarlos.
 */
export class CharacterValidationError extends Error {
  constructor(
    public readonly source: string,
    public readonly issues: readonly z.core.$ZodIssue[],
  ) {
    const lines = issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<raíz>';
      return `  ${path}: ${issue.message}`;
    });
    super(`Personaje inválido en ${source}:\n${lines.join('\n')}`);
    this.name = 'CharacterValidationError';
  }
}

export class CharacterLoader {
  private readonly logger: Logger;

  constructor(options: { logger: Logger }) {
    this.logger = options.logger.child({ module: 'CharacterLoader' });
  }

  /** Lee un YAML del disco y lo valida. `path` es relativo al cwd o absoluto. */
  loadFromFile(path: string): Character {
    this.logger.debug(`reading character file ${path}`);
    const content = readFileSync(path, 'utf8');
    return this.loadFromString(content, path);
  }

  /**
   * Valida un YAML ya leído. Útil en tests sin tocar disco.
   * `sourceLabel` solo se usa para los mensajes de error.
   */
  loadFromString(content: string, sourceLabel = '<string>'): Character {
    const parsed: unknown = parseYaml(content);
    const result = CharacterSchema.safeParse(parsed);
    if (!result.success) {
      throw new CharacterValidationError(sourceLabel, result.error.issues);
    }
    return result.data;
  }
}
