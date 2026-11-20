/**
 * Integration test del bootstrap completo del core-host.
 *
 * Valida que el cliente WebSocketTransport se conecta, emite
 * `user:message`, y recibe la cadena de eventos que el simulador del
 * server genera (`router:routed` → `llm:responded` → `tts:audio-ended`).
 *
 * Es el primer test "end-to-end real" del split cliente/server.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterSchema,
  EventBus,
  Logger,
  ModulesConfigSchema,
  WebSocketTransport,
  type Character,
  type EventMap,
  type WebSocketCtor,
} from '@proyecto-shiro/core';
import { WebSocket } from 'ws';
import { parse as parseYaml } from 'yaml';
import { MemoryManager } from '@proyecto-shiro/core/node';
import { bootstrap, type BootstrapResult } from '../../src/bootstrap.js';
import { WebSocketServerTransport } from '../../src/transports/websocket-server-transport.js';

const FIXTURE_YAML = `
version: 1
modules:
  llm:
    local:
      active: OllamaLLM
      config: { model: 'mock' }
    cloud:
      active: AnthropicLLM
      config: { model: 'mock-cloud' }
  router:
    active: HybridRouter
    config: {}
  stt:
    active: WhisperSTT
    config: { language: 'es' }
  tts:
    active: ElevenLabsTTS
    config: { voice_id: 'mock' }
  memory:
    active: MemoryManager
    config:
      user_id: 'default'
      letta:
        base_url: 'http://localhost:8283'
        agent_id: 'test-agent'
        timeout_ms: 100
      local:
        db_path: ':memory:'
      drainer:
        interval_ms: 60000
        batch_size: 10
  avatar:
    active: Live2DAvatar
    config: {}
character:
  file: 'src/character/characters/default.yaml'
`;

const FIXTURE_CHARACTER: Character = CharacterSchema.parse({
  version: 1,
  identity: {
    name: 'Shiro',
    pronouns: 'ella',
  },
  personality: {
    traits: ['curiosa', 'directa'],
    speech_style: 'natural',
  },
});

function loadFixtureConfig() {
  return ModulesConfigSchema.parse(parseYaml(FIXTURE_YAML));
}

function makeLogger(): Logger {
  return new Logger('error', { module: 'integration' });
}

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 3000, intervalMs = 10 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: timeout tras ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Carpetas temporales de los tests que usan una memoria en disco. */
const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe('core-host bootstrap end-to-end', () => {
  let result: BootstrapResult | null = null;

  afterEach(async () => {
    if (result) {
      await result.shutdown();
      result = null;
    }
  });

  it('escucha en 127.0.0.1 por defecto', async () => {
    result = await bootstrap({
      port: 0,
      config: loadFixtureConfig(),
      character: FIXTURE_CHARACTER,
      logger: makeLogger(),
      simulationSpeed: 0,
    });
    expect(result.transport.address).toBe('127.0.0.1');
  });

  // P-11a: `npm run backup` anota cada copia al lado de la memoria.
  it('el informe de salud lleva la fecha de la última copia de la memoria', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'shiro-bootstrap-backup-'));
    tempDirs.push(dataDir);
    const record = { at: '2026-11-19T10:00:00.000Z', complete: false, lastCompleteAt: null };
    writeFileSync(
      join(dataDir, 'last-backup.json'),
      JSON.stringify({ ...record, name: '20261119T100000Z', turns: 3 }),
    );
    const dbPath = join(dataDir, 'memory.db').replaceAll('\\', '/');
    const yaml = FIXTURE_YAML.replace(`db_path: ':memory:'`, `db_path: '${dbPath}'`);
    expect(yaml).not.toBe(FIXTURE_YAML);

    result = await bootstrap({
      port: 0,
      config: ModulesConfigSchema.parse(parseYaml(yaml)),
      character: FIXTURE_CHARACTER,
      logger: makeLogger(),
      simulationSpeed: 0,
    });
    const reports: EventMap['system:health'][] = [];
    result.bus.on('system:health', (report) => {
      reports.push(report);
    });
    await result.bus.emit('system:health-check', {});

    await waitFor(() => reports.length > 0, { timeoutMs: 8000 });
    expect(reports[0]?.lastBackup).toEqual(record);
  }, 15_000);

  it('un fallo de clave de la nube vuelve a emitir system:health con el problema', async () => {
    result = await bootstrap({
      port: 0,
      config: loadFixtureConfig(),
      character: FIXTURE_CHARACTER,
      logger: makeLogger(),
      simulationSpeed: 0,
    });
    const reports: EventMap['system:health'][] = [];
    result.bus.on('system:health', (report) => {
      reports.push(report);
    });

    await result.bus.emit('llm:failed', { reason: 'auth', tier: 'cloud', userId: 'me' });

    await waitFor(() => reports.some((report) => report.readiness?.cloud === 'auth'), {
      timeoutMs: 8000,
    });
  }, 15_000);

  it('arranca, registra mocks, emite bus:ready', async () => {
    const readyEvents: { startedAt: string }[] = [];

    result = await bootstrap({
      port: 0,
      config: loadFixtureConfig(),
      character: FIXTURE_CHARACTER,
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    // bus:ready ya se emitió durante init — nos suscribimos después,
    // así que verificamos los módulos cargados en su lugar.
    const modules = result.orchestrator.getModules();
    // LLMs, Router, Memory, STT, TTS y Avatar son ya implementaciones reales.
    // El ping del microservicio Whisper y la API key de ElevenLabs solo se
    // verifican al usarse — la instanciación no requiere conectividad.
    expect(modules.llmLocal.id).toMatch(/^llm:ollama:/);
    expect(modules.llmCloud.id).toMatch(/^llm:anthropic:/);
    expect(modules.router.id).toBe('router:hybrid');
    expect(modules.stt.id).toBe('stt:whisper');
    // El slot tts del orchestrator es el primary (ElevenLabsTTS); el
    // pipeline en realidad recibe un `TtsWithFallback` que el bootstrap
    // construye aparte y envuelve primary + SystemTTS. El módulo del
    // orchestrator es solo el primary.
    expect(modules.tts.id).toBe('tts:elevenlabs:mock');
    expect(modules.memory.id).toBe('memory:manager:default');
    // Live2DAvatar es lógico server-side — el render real vive en el
    // cliente desktop (siguiente PR del hito). Ver ADR 0021.
    expect(modules.avatar.id).toBe('avatar:live2d');

    // El transport está escuchando.
    expect(result.transport.port).toBeGreaterThan(0);

    // El personaje está cargado y el systemPrompt pre-construido.
    expect(result.character.identity.name).toBe('Shiro');
    expect(result.systemPrompt).toMatch(/Eres Shiro/);

    // Comprueba que bus:ready se pueda re-emitir sin error tras `on`.
    result.bus.on('bus:ready', (p) => {
      readyEvents.push(p);
    });
    await result.bus.emit('bus:ready', { startedAt: '2026-05-27T00:00:00.000Z' });
    expect(readyEvents).toHaveLength(1);
  });

  it(
    'un cliente conectado recibe la cadena completa al emitir user:message',
    { timeout: 20_000 },
    async () => {
      result = await bootstrap({
        port: 0,
        config: loadFixtureConfig(),
        character: FIXTURE_CHARACTER,
        logger: makeLogger(),
        simulationSpeed: 0,
      });

      const clientTransport = new WebSocketTransport({
        url: `ws://localhost:${result.transport.port}/bus`,
        logger: makeLogger(),
        webSocketCtor: WebSocket as unknown as WebSocketCtor,
      });
      const clientBus = new EventBus<EventMap>({
        logger: makeLogger(),
        transports: [clientTransport],
      });

      await waitFor(() => clientTransport.getState() === 'open');

      const routed: EventMap['router:routed'][] = [];
      const responded: EventMap['llm:responded'][] = [];
      // Tras el LLM, el server o bien emite `tts:audio` (cadena TTS OK)
      // o `tts:audio-ended` (cadena TTS entera falló). Cualquiera de las
      // dos cierra el turno desde el punto de vista del server.
      let turnFinished = false;
      clientBus.on('router:routed', (p) => {
        routed.push(p);
      });
      clientBus.on('llm:responded', (p) => {
        responded.push(p);
      });
      clientBus.on('tts:audio', () => {
        turnFinished = true;
      });
      clientBus.on('tts:audio-ended', () => {
        turnFinished = true;
      });

      await clientBus.emit('user:message', { text: 'hola Shiro', userId: 'me' });

      // Presupuesto generoso: el turno pasa por router (timeout 2s) + LLM
      // real/fallback. Con la suite entera en paralelo, los 3s por defecto
      // de waitFor se quedaban cortos y el test salía flaky.
      await waitFor(() => turnFinished, { timeoutMs: 15_000 });

      expect(routed).toHaveLength(1);
      expect(routed[0]).toMatchObject({ userId: 'me' });

      expect(responded).toHaveLength(1);
      expect(responded[0]?.text).toBeTruthy();
      expect(responded[0]?.emotion).toBeDefined();

      await clientTransport.close();
    },
  );

  it(
    'un cliente que conecta después recibe lo hablado, aunque Letta no esté',
    { timeout: 30_000 },
    async () => {
      result = await bootstrap({
        port: 0,
        config: loadFixtureConfig(),
        character: FIXTURE_CHARACTER,
        logger: makeLogger(),
        simulationSpeed: 0,
      });
      const url = `ws://localhost:${result.transport.port}/bus`;
      const connect = (): { bus: EventBus<EventMap>; transport: WebSocketTransport } => {
        const transport = new WebSocketTransport({
          url,
          logger: makeLogger(),
          webSocketCtor: WebSocket as unknown as WebSocketCtor,
        });
        return {
          bus: new EventBus<EventMap>({ logger: makeLogger(), transports: [transport] }),
          transport,
        };
      };

      // El cliente habla como «me»; la config del servidor dice «default».
      const first = connect();
      await waitFor(() => first.transport.getState() === 'open');
      let turnFinished = false;
      first.bus.on('tts:audio', () => {
        turnFinished = true;
      });
      first.bus.on('tts:audio-ended', () => {
        turnFinished = true;
      });
      await first.bus.emit('user:message', { text: 'recuerda esto', userId: 'me' });
      await waitFor(() => turnFinished, { timeoutMs: 15_000 });

      const second = connect();
      const snapshots: EventMap['memory:snapshot'][] = [];
      second.bus.on('memory:snapshot', (payload) => {
        snapshots.push(payload);
      });
      await waitFor(() => snapshots.length > 0, { timeoutMs: 5_000 });

      const texts = snapshots[0]?.entries.map((entry) => entry.text) ?? [];
      expect(texts).toContain('recuerda esto');

      await first.transport.close();
      await second.transport.close();
    },
  );

  it('múltiples clientes reciben los mismos eventos del server', { timeout: 20_000 }, async () => {
    result = await bootstrap({
      port: 0,
      config: loadFixtureConfig(),
      character: FIXTURE_CHARACTER,
      logger: makeLogger(),
      simulationSpeed: 0,
    });

    const url = `ws://localhost:${result.transport.port}/bus`;
    const cliente1 = new WebSocketTransport({
      url,
      logger: makeLogger(),
      webSocketCtor: WebSocket as unknown as WebSocketCtor,
    });
    const cliente2 = new WebSocketTransport({
      url,
      logger: makeLogger(),
      webSocketCtor: WebSocket as unknown as WebSocketCtor,
    });
    const bus1 = new EventBus<EventMap>({
      logger: makeLogger(),
      transports: [cliente1],
    });
    const bus2 = new EventBus<EventMap>({
      logger: makeLogger(),
      transports: [cliente2],
    });

    await waitFor(() => cliente1.getState() === 'open' && cliente2.getState() === 'open');

    const r1: EventMap['llm:responded'][] = [];
    const r2: EventMap['llm:responded'][] = [];
    bus1.on('llm:responded', (p) => {
      r1.push(p);
    });
    bus2.on('llm:responded', (p) => {
      r2.push(p);
    });

    await bus1.emit('user:message', { text: 'ping', userId: 'u' });
    await waitFor(() => r1.length === 1 && r2.length === 1, { timeoutMs: 15_000 });

    expect(r1[0]?.text).toBe(r2[0]?.text);

    await cliente1.close();
    await cliente2.close();
  });
});

// P-13 (R-059, R-089): el servidor atendía conexiones antes de poner los
// manejadores, y el arranque esperaba a Letta. Un cliente que conectaba en
// ese rato perdía el historial, el estado de los servicios y sus primeros
// mensajes.
describe('core-host bootstrap — arranque ordenado (P-13)', () => {
  let result: BootstrapResult | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (result) {
      await result.shutdown();
      result = null;
    }
  });

  function start(port = 0): Promise<BootstrapResult> {
    return bootstrap({
      port,
      config: loadFixtureConfig(),
      character: FIXTURE_CHARACTER,
      logger: makeLogger(),
      simulationSpeed: 0,
    });
  }

  it('empieza a atender al final, con los manejadores de conexión ya puestos', async () => {
    const order: string[] = [];
    const proto = WebSocketServerTransport.prototype;
    const onConnection = proto.onConnection;
    const acceptConnections = proto.acceptConnections;
    vi.spyOn(proto, 'onConnection').mockImplementation(function (
      this: WebSocketServerTransport,
      handler,
    ) {
      order.push('onConnection');
      onConnection.call(this, handler);
    });
    vi.spyOn(proto, 'acceptConnections').mockImplementation(function (
      this: WebSocketServerTransport,
    ) {
      order.push('acceptConnections');
      acceptConnections.call(this);
    });

    result = await start();

    expect(order.filter((step) => step === 'onConnection').length).toBeGreaterThanOrEqual(2);
    expect(order.at(-1)).toBe('acceptConnections');
    expect(order.filter((step) => step === 'acceptConnections')).toHaveLength(1);
  });

  it(
    'no espera a Letta: aunque la memoria tarde en arrancar, atiende y manda el estado',
    { timeout: 20_000 },
    async () => {
      // El arranque de la memoria (el primer ping a Letta) no termina nunca.
      vi.spyOn(MemoryManager.prototype, 'start').mockReturnValue(new Promise(() => undefined));

      result = await start();

      const transport = new WebSocketTransport({
        url: `ws://localhost:${result.transport.port}/bus`,
        logger: makeLogger(),
        webSocketCtor: WebSocket as unknown as WebSocketCtor,
      });
      const bus = new EventBus<EventMap>({ logger: makeLogger(), transports: [transport] });
      const reports: EventMap['system:health'][] = [];
      bus.on('system:health', (report) => {
        reports.push(report);
      });
      await waitFor(() => reports.length > 0, { timeoutMs: 10_000 });

      expect(reports[0]?.services).toBeDefined();
      await transport.close();
    },
  );

  it('con el puerto ocupado falla enseguida, sin arrancar la memoria ni nada más', async () => {
    result = await start();
    const startMemory = vi.spyOn(MemoryManager.prototype, 'start');

    // Una segunda copia en el mismo puerto: es la que tiene que apartarse.
    await expect(start(result.transport.port)).rejects.toMatchObject({ code: 'EADDRINUSE' });

    expect(startMemory).not.toHaveBeenCalled();
  });
});
