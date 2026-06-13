/**
 * Test de integración del bootstrap completo del core.
 *
 * Verifica el hito de Fase 1: "registrar módulos falsos y el flujo
 * completo pasa sin errores" (cita textual del plan).
 *
 * Cubre:
 * - ConfigLoader parsea YAML y valida con zod.
 * - ModuleLoader resuelve nombres del config a factories registradas.
 * - Orchestrator instancia todos los módulos y emite bus:ready.
 * - Los módulos cargados son accesibles y funcionales vía getModules().
 * - Errores claros cuando el config referencia módulos no registrados
 *   o cuando se llama init() dos veces.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventBus,
  Logger,
  ModuleLoader,
  ModuleLoaderError,
  ModulesConfigSchema,
  Orchestrator,
  OrchestratorError,
  ToolsRegistry,
} from '../../src/index.js';
import { ConfigLoader, ConfigValidationError } from '../../src/node.js';
import type { ModuleDeps } from '../../src/core/module-loader.js';
import {
  MockAvatar,
  MockLLM,
  MockMemory,
  MockRouter,
  MockSTT,
  MockTTS,
} from './mocks/mock-modules.js';

/**
 * YAML válido con todos los slots referenciando los mocks.
 * Sirve como fixture para el camino feliz.
 */
const VALID_YAML = `
version: 1
modules:
  llm:
    local:
      active: MockLLM
      config:
        model: 'mock-local'
    cloud:
      active: MockLLM
      config:
        model: 'mock-cloud'
  router:
    active: MockRouter
    config: {}
  stt:
    active: MockSTT
    config:
      language: 'es'
  tts:
    active: MockTTS
    fallback_chain:
      - MockTTS
    config:
      voice_id: 'mock-voice'
  memory:
    active: MockMemory
    config: {}
  avatar:
    active: MockAvatar
    config: {}
character:
  file: 'src/character/characters/default.yaml'
`;

function silentLogger(): Logger {
  return new Logger('error');
}

function registerAllMocks(loader: ModuleLoader): void {
  loader.register('MockLLM', () => new MockLLM());
  loader.register('MockRouter', () => new MockRouter());
  loader.register('MockSTT', () => new MockSTT());
  loader.register('MockTTS', () => new MockTTS());
  loader.register('MockMemory', () => new MockMemory());
  loader.register('MockAvatar', () => new MockAvatar());
  // El slot `tools` se default-ea a ToolsRegistry en el schema (ADR 0022).
  loader.register('ToolsRegistry', (cfg, deps) => new ToolsRegistry(cfg, deps));
}

describe('bootstrap completo del core', () => {
  let logger: Logger;
  let bus: EventBus;
  let loader: ModuleLoader;
  let configLoader: ConfigLoader;

  beforeEach(() => {
    // Silencia console.error/warn para los tests que disparan logs de
    // error intencionalmente (orchestrator init dos veces, factory
    // faltante). El Logger ahora usa console.* como sink (ADR 0011).
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger = silentLogger();
    bus = new EventBus({ logger });
    loader = new ModuleLoader({ logger });
    configLoader = new ConfigLoader({ logger });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('camino feliz', () => {
    it('carga config, instancia mocks y emite bus:ready', async () => {
      registerAllMocks(loader);
      const config = configLoader.loadFromString(VALID_YAML, ModulesConfigSchema);

      const readyHandler = vi.fn();
      bus.on('bus:ready', readyHandler);

      const orchestrator = new Orchestrator({ bus, loader, logger, config });
      await orchestrator.init();

      expect(orchestrator.isStarted()).toBe(true);
      expect(readyHandler).toHaveBeenCalledOnce();
      // Verifica el payload sin desestructurar mock.calls (que es any[][]).
      expect(readyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ startedAt: expect.any(String) as string }),
      );
    });

    it('expone los módulos cargados via getModules()', async () => {
      registerAllMocks(loader);
      const config = configLoader.loadFromString(VALID_YAML, ModulesConfigSchema);
      const orchestrator = new Orchestrator({ bus, loader, logger, config });
      await orchestrator.init();

      const modules = orchestrator.getModules();
      expect(modules.llmLocal).toBeInstanceOf(MockLLM);
      expect(modules.llmCloud).toBeInstanceOf(MockLLM);
      expect(modules.router).toBeInstanceOf(MockRouter);
      expect(modules.stt).toBeInstanceOf(MockSTT);
      expect(modules.tts).toBeInstanceOf(MockTTS);
      expect(modules.memory).toBeInstanceOf(MockMemory);
      expect(modules.avatar).toBeInstanceOf(MockAvatar);
      // Slot `tools` (ADR 0022): registry vacío en este PR (andamiaje).
      expect(modules.tools).toBeInstanceOf(ToolsRegistry);
      expect(modules.tools.list()).toEqual([]);
    });

    it('módulos cargados son funcionales (LLM responde)', async () => {
      registerAllMocks(loader);
      const config = configLoader.loadFromString(VALID_YAML, ModulesConfigSchema);
      const orchestrator = new Orchestrator({ bus, loader, logger, config });
      await orchestrator.init();

      const { llmLocal } = orchestrator.getModules();
      const response = await llmLocal.generate({ text: 'hola Shiro' });
      expect(response.text).toBe('echo: hola Shiro');
      expect(response.emotion).toBe('neutral');
    });

    it('shutdown() limpia el estado y permite re-init', async () => {
      registerAllMocks(loader);
      const config = configLoader.loadFromString(VALID_YAML, ModulesConfigSchema);
      const orchestrator = new Orchestrator({ bus, loader, logger, config });

      await orchestrator.init();
      expect(orchestrator.isStarted()).toBe(true);

      await orchestrator.shutdown();
      expect(orchestrator.isStarted()).toBe(false);

      // re-init debe funcionar
      await orchestrator.init();
      expect(orchestrator.isStarted()).toBe(true);
    });
  });

  describe('errores', () => {
    it('falla si el config referencia un módulo no registrado', () => {
      // Solo registramos MockLLM (no Router, STT, etc.)
      loader.register('MockLLM', () => new MockLLM());
      const config = configLoader.loadFromString(VALID_YAML, ModulesConfigSchema);
      const orchestrator = new Orchestrator({ bus, loader, logger, config });

      // init() debe rechazar con un ModuleLoaderError
      return expect(orchestrator.init()).rejects.toBeInstanceOf(ModuleLoaderError);
    });

    it('init() dos veces consecutivas lanza OrchestratorError', async () => {
      registerAllMocks(loader);
      const config = configLoader.loadFromString(VALID_YAML, ModulesConfigSchema);
      const orchestrator = new Orchestrator({ bus, loader, logger, config });

      await orchestrator.init();
      await expect(orchestrator.init()).rejects.toBeInstanceOf(OrchestratorError);
    });

    it('getModules() antes de init() lanza OrchestratorError', () => {
      const config = configLoader.loadFromString(VALID_YAML, ModulesConfigSchema);
      const orchestrator = new Orchestrator({ bus, loader, logger, config });
      expect(() => orchestrator.getModules()).toThrow(OrchestratorError);
    });

    it('config inválido (sin version) falla en ConfigLoader, no llega a Orchestrator', () => {
      const invalidYaml = `
modules:
  llm:
    local:
      active: MockLLM
`;
      expect(() => {
        configLoader.loadFromString(invalidYaml, ModulesConfigSchema);
      }).toThrow(ConfigValidationError);
    });
  });

  describe('introspección del ModuleLoader', () => {
    it('listRegistered() devuelve todos los nombres registrados', () => {
      registerAllMocks(loader);
      const names = loader.listRegistered();
      expect(names).toContain('MockLLM');
      expect(names).toContain('MockRouter');
      expect(names).toContain('MockSTT');
      expect(names).toContain('MockTTS');
      expect(names).toContain('MockMemory');
      expect(names).toContain('MockAvatar');
    });

    it('has(name) detecta correctamente', () => {
      registerAllMocks(loader);
      expect(loader.has('MockLLM')).toBe(true);
      expect(loader.has('UnknownModule')).toBe(false);
    });

    it('clear() resetea las factories', () => {
      registerAllMocks(loader);
      expect(loader.listRegistered().length).toBeGreaterThan(0);
      loader.clear();
      expect(loader.listRegistered()).toEqual([]);
    });

    it('register sobrescribe factory existente y loguea warn', () => {
      // El Logger ahora usa console.* como sink (ADR 0011), así que el
      // spy va sobre console.warn en lugar de process.stderr.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const verboseLogger = new Logger('warn');
      const verbose = new ModuleLoader({ logger: verboseLogger });

      const first = (_cfg: unknown, _deps: ModuleDeps): MockLLM => new MockLLM();
      const second = (_cfg: unknown, _deps: ModuleDeps): MockLLM => new MockLLM();
      verbose.register('MockLLM', first);
      verbose.register('MockLLM', second);

      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
