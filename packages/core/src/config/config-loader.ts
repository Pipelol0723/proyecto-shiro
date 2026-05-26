/**
 * ConfigLoader — lee archivos YAML del disco y los valida con zod.
 *
 * Diseño separa la lectura del disco de la validación:
 *
 *   loadFromFile(path, schema)   ← I/O + parse + validate
 *   loadFromString(yaml, schema) ← solo parse + validate (testeable)
 *
 * Si la validación falla, lanza un `ConfigValidationError` con los
 * paths de los campos problemáticos formateados de forma legible.
 *
 * Ver ADR 0006 (validación con zod) y ADR 0001 (modular event-driven).
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';

import type { Logger } from '../core/logger.js';
import {
  type DevicesConfig,
  DevicesConfigSchema,
  type ModulesConfig,
  ModulesConfigSchema,
} from './schemas.js';

/**
 * Error específico de validación de config. Encapsula el origen y los
 * issues estructurados de zod para que el caller pueda decidir cómo
 * presentarlos.
 */
export class ConfigValidationError extends Error {
  constructor(
    public readonly source: string,
    public readonly issues: readonly z.core.$ZodIssue[],
  ) {
    const lines = issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<raíz>';
      return `  ${path}: ${issue.message}`;
    });
    super(`Configuración inválida en ${source}:\n${lines.join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigLoader {
  private readonly logger: Logger;

  constructor(options: { logger: Logger }) {
    this.logger = options.logger.child({ module: 'ConfigLoader' });
  }

  /**
   * Carga un archivo YAML del disco y lo valida contra el schema dado.
   * El parámetro `path` es ruta absoluta o relativa al cwd actual.
   */
  loadFromFile<T>(path: string, schema: z.ZodType<T>): T {
    this.logger.debug(`reading config file ${path}`);
    const content = readFileSync(path, 'utf8');
    return this.loadFromString(content, schema, path);
  }

  /**
   * Valida un YAML ya leído (útil para tests sin tocar disco).
   * `sourceLabel` solo se usa para los mensajes de error.
   */
  loadFromString<T>(content: string, schema: z.ZodType<T>, sourceLabel = '<string>'): T {
    const parsed: unknown = parseYaml(content);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigValidationError(sourceLabel, result.error.issues);
    }
    return result.data;
  }

  /** Atajo tipado para el archivo `modules.config.yaml`. */
  loadModulesConfig(path: string): ModulesConfig {
    return this.loadFromFile(path, ModulesConfigSchema);
  }

  /** Atajo tipado para el archivo `devices.config.yaml`. */
  loadDevicesConfig(path: string): DevicesConfig {
    return this.loadFromFile(path, DevicesConfigSchema);
  }
}
