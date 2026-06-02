/**
 * Tests del `WhisperSttClient` — cubren el ciclo abrir/streaming/stop
 * y los caminos de error sin tocar WebSocket real. Usa un `FakeWebSocket`
 * que el cliente acepta a través de la opción `webSocketCtor`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhisperSttClient } from '../../src/audio/whisper-stt-client';

interface SentItem {
  kind: 'binary' | 'text';
  data: ArrayBuffer | string;
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
  readyState: number = FakeWebSocket.CONNECTING;
  readonly url: string;
  readonly sent: SentItem[] = [];

  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: ArrayBuffer | string): void {
    if (data instanceof ArrayBuffer) {
      this.sent.push({ kind: 'binary', data });
    } else {
      this.sent.push({ kind: 'text', data });
    }
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
  }

  // Helpers para los tests
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  simulateMessage(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  simulateClose(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code }));
  }
  simulateError(): void {
    this.dispatchEvent(new Event('error'));
  }

  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (last === undefined) throw new Error('no FakeWebSocket creado todavía');
    return last;
  }
  static reset(): void {
    FakeWebSocket.instances = [];
  }
}

describe('WhisperSttClient', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeClient(
    callbacks: {
      onPartial?: (t: string) => void;
      onFinal?: (t: string) => void;
      onError?: (r: string) => void;
    } = {},
  ): WhisperSttClient {
    return new WhisperSttClient({
      url: 'ws://x:8765/stt',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      ...callbacks,
    });
  }

  it('open() resuelve cuando el WS llega a OPEN', async () => {
    const client = makeClient();
    const pending = client.open();
    FakeWebSocket.last().simulateOpen();
    await pending;
    expect(client.state).toBe('streaming');
  });

  it('open() rechaza si el WS cierra antes de OPEN', async () => {
    const client = makeClient();
    const pending = client.open();
    FakeWebSocket.last().simulateClose(1006);
    await expect(pending).rejects.toThrow(/antes de open/);
    expect(client.state).toBe('error');
  });

  it('sendChunk envía el buffer crudo por el WS', async () => {
    const client = makeClient();
    const pending = client.open();
    FakeWebSocket.last().simulateOpen();
    await pending;

    const buf = new ArrayBuffer(8);
    expect(client.sendChunk(buf)).toBe(true);

    const sent = FakeWebSocket.last().sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe('binary');
    expect(sent[0]?.data).toBe(buf);
  });

  it('sendChunk devuelve false si no estamos en streaming', () => {
    const client = makeClient();
    expect(client.sendChunk(new ArrayBuffer(4))).toBe(false);
  });

  it('partial dispara onPartial con el texto', async () => {
    const onPartial = vi.fn<(text: string) => void>();
    const client = makeClient({ onPartial });
    const pending = client.open();
    FakeWebSocket.last().simulateOpen();
    await pending;

    FakeWebSocket.last().simulateMessage(JSON.stringify({ type: 'partial', text: 'hola mu' }));
    expect(onPartial).toHaveBeenCalledWith('hola mu');
  });

  it('partial mal formado se ignora sin lanzar', async () => {
    const onPartial = vi.fn<(text: string) => void>();
    const client = makeClient({ onPartial });
    const pending = client.open();
    FakeWebSocket.last().simulateOpen();
    await pending;

    FakeWebSocket.last().simulateMessage('not json');
    FakeWebSocket.last().simulateMessage(JSON.stringify({ type: 'unknown' }));
    expect(onPartial).not.toHaveBeenCalled();
  });

  it('stop() manda `{type:"stop"}` y espera transcribed', async () => {
    const onFinal = vi.fn<(text: string) => void>();
    const client = makeClient({ onFinal });
    const openPending = client.open();
    FakeWebSocket.last().simulateOpen();
    await openPending;

    const stopPending = client.stop();
    const sent = FakeWebSocket.last().sent;
    expect(sent[sent.length - 1]?.kind).toBe('text');
    expect(JSON.parse(sent[sent.length - 1]?.data as string)).toEqual({ type: 'stop' });

    FakeWebSocket.last().simulateMessage(
      JSON.stringify({ type: 'transcribed', text: 'hola mundo', isFinal: true }),
    );
    await stopPending;
    expect(onFinal).toHaveBeenCalledWith('hola mundo');
    expect(client.state).toBe('closed');
  });

  it('error del servidor dispara onError y deja el cliente en error', async () => {
    const onError = vi.fn<(r: string) => void>();
    const client = makeClient({ onError });
    const openPending = client.open();
    FakeWebSocket.last().simulateOpen();
    await openPending;

    FakeWebSocket.last().simulateMessage(JSON.stringify({ type: 'error', message: 'boom' }));
    expect(onError).toHaveBeenCalledWith('boom');
    expect(client.state).toBe('error');
  });

  it('cierre del WS sin transcribed final dispara onError', async () => {
    const onError = vi.fn<(r: string) => void>();
    const client = makeClient({ onError });
    const openPending = client.open();
    FakeWebSocket.last().simulateOpen();
    await openPending;

    FakeWebSocket.last().simulateClose(1011);
    expect(onError).toHaveBeenCalled();
    expect(client.state).toBe('error');
  });

  it('abort() cierra sin esperar y deja el cliente en closed', async () => {
    const client = makeClient();
    const openPending = client.open();
    FakeWebSocket.last().simulateOpen();
    await openPending;

    client.abort();
    expect(client.state).toBe('closed');
  });
});
