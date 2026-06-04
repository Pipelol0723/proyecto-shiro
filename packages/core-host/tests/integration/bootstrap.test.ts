/**
 * Integration test del bootstrap completo del core-host.
 *
 * Valida que el cliente WebSocketTransport se conecta, emite
 * `user:message`, y recibe la cadena de eventos que el simulador del
 * server genera (`router:routed` → `llm:responded` → `tts:audio-ended`).
 *
 * Es el primer test "end-to-end real" del split cliente/server.
 */

import { afterEach, describe, expect, it } from 'vitest';
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
import { bootstrap, type BootstrapResult } from '../../src/bootstrap.js';

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

describe('core-host bootstrap end-to-end', () => {
  let result: BootstrapResult | null = null;

  afterEach(async () => {
    if (result) {
      await result.shutdown();
      result = null;
    }
  });

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

  it('un cliente conectado recibe la cadena completa al emitir user:message', async () => {
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

    await waitFor(() => turnFinished);

    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({ userId: 'me' });

    expect(responded).toHaveLength(1);
    expect(responded[0]?.text).toBeTruthy();
    expect(responded[0]?.emotion).toBeDefined();

    await clientTransport.close();
  });

  it('múltiples clientes reciben los mismos eventos del server', async () => {
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
    await waitFor(() => r1.length === 1 && r2.length === 1);

    expect(r1[0]?.text).toBe(r2[0]?.text);

    await cliente1.close();
    await cliente2.close();
  });
});
