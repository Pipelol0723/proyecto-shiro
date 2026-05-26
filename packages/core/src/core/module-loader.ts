/**
 * ModuleLoader — registry de factories que convierten nombres en YAML
 * a instancias de módulos.
 *
 * Patrón: Factory registry (ver ADR 0007).
 *
 *   1. En el bootstrap, cada módulo concreto llama a `register(name, factory)`.
 *   2. El Orchestrator consume el config validado y pide instancias con
 *      `load<T>(name, config, deps)`.
 *   3. La factory recibe el bloque `config` del YAML y un `ModuleDeps`
 *      con singletons (logger, bus) inyectados.
 *
 * El loader no conoce a ningún módulo en particular — todo va via el Map.
 * Esto permite registrar tanto implementaciones reales (OllamaLLM,
 * ElevenLabsTTS, …) como mocks de tests usando los mismos nombres.
 */

import type { IEventBus } from '../interfaces/IEventBus.js';
import type { Logger } from './logger.js';

/**
 * Dependencias inyectadas a cada factory al instanciar.
 * Extensible — añadir aquí nuevos singletons cuando aparezcan
 * (DeviceRegistry, MetricsCollector, etc.).
 */
export interface ModuleDeps {
  logger: Logger;
  bus: IEventBus;
}

/**
 * Función que construye una instancia del módulo a partir del config
 * (validado o no por su propio schema interno) y las deps.
 */
export type ModuleFactory<T> = (config: unknown, deps: ModuleDeps) => T;

export class ModuleLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleLoaderError';
  }
}

export class ModuleLoader {
  private readonly factories = new Map<string, ModuleFactory<unknown>>();
  private readonly logger: Logger;

  constructor(options: { logger: Logger }) {
    this.logger = options.logger.child({ module: 'ModuleLoader' });
  }

  /**
   * Registra una factory bajo el nombre indicado. Si ya existía otra
   * con el mismo nombre, la sobreescribe (último registrado gana) y
   * loguea un warning — esto suele ser un bug en el bootstrap.
   */
  register<T>(name: string, factory: ModuleFactory<T>): void {
    if (this.factories.has(name)) {
      this.logger.warn(`sobreescribiendo factory existente para ${name}`);
    }
    this.factories.set(name, factory);
    this.logger.debug(`factory registrada: ${name}`);
  }

  /**
   * Instancia el módulo asociado al nombre.
   *
   * El llamador especifica `T` (p. ej. `ILLMModule`) para que el valor
   * devuelto venga ya tipado. El cast interno es seguro siempre que la
   * factory registrada produzca el tipo correcto — convención
   * verificada en code review y en los tests de integración.
   */
  load<T>(name: string, config: unknown, deps: ModuleDeps): T {
    const factory = this.factories.get(name);
    if (!factory) {
      const available = this.listRegistered();
      const list = available.length > 0 ? available.join(', ') : '<ninguno>';
      throw new ModuleLoaderError(
        `No hay factory registrada para '${name}'. Registradas: ${list}.`,
      );
    }
    this.logger.debug(`instanciando ${name}`);
    return factory(config, deps) as T;
  }

  /** True si existe una factory para el nombre dado. */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** Snapshot de los nombres registrados. Útil para tests y diagnostics. */
  listRegistered(): readonly string[] {
    return Array.from(this.factories.keys());
  }

  /** Limpia todas las factories registradas. Útil para tests. */
  clear(): void {
    this.factories.clear();
  }
}
