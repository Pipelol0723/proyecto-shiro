/**
 * Tests del `WhisperSttClient` — cubren el ciclo abrir/streaming/stop
 * y los caminos de error sin tocar WebSocket real. Usa un `FakeWebSocket`
 * que el cliente acepta a través de la opción `webSocketCtor`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_FINAL_TIMEOUT_MS,
  MAX_PENDING_BYTES,
  PCM_BYTES_PER_SECOND,
  WhisperSttClient,
  WhisperSttError,
} from '../../src/audio/whisper-stt-client';

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
    expect(onError).toHaveBeenCalledWith('boom', 'server');
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

// P-15a (R-322, R-143): un Whisper que no contesta no deja el turno colgado, y
// lo que se dice mientras abre la conexión no se pierde.
describe('WhisperSttClient — plazos y audio durante la apertura', () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  type ErrorCallback = (reason: string, code: string) => void;

  function makeClient(onError?: ErrorCallback): WhisperSttClient {
    return new WhisperSttClient({
      url: 'ws://x:8765/stt',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      ...(onError !== undefined && { onError }),
    });
  }

  const chunk = (...bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;
  const binaries = (ws: FakeWebSocket): number[][] =>
    ws.sent
      .filter((item) => item.kind === 'binary')
      .map((item) => [...new Uint8Array(item.data as ArrayBuffer)]);
  const texts = (ws: FakeWebSocket): unknown[] =>
    ws.sent
      .filter((item) => item.kind === 'text')
      .map((item) => JSON.parse(item.data as string) as unknown);

  /** Recoge el rechazo sin dejar la promesa suelta mientras corre el reloj. */
  function settled(promise: Promise<void>): Promise<unknown> {
    return promise.then(
      () => 'resuelta',
      (err: unknown) => err,
    );
  }

  it('si el WS no abre a tiempo, open() falla, cierra el socket y lo dice con su tipo', async () => {
    const client = makeClient();
    const opening = settled(client.open());
    const ws = FakeWebSocket.last();

    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_TIMEOUT_MS - 1);
    expect(client.state).toBe('connecting');

    await vi.advanceTimersByTimeAsync(1);
    const err = await opening;

    expect(err).toBeInstanceOf(WhisperSttError);
    expect((err as WhisperSttError).code).toBe('connect-timeout');
    expect(client.state).toBe('error');
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('el plazo de conexión se puede acortar', async () => {
    const client = new WhisperSttClient({
      url: 'ws://x:8765/stt',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      connectTimeoutMs: 500,
    });
    const opening = settled(client.open());
    await vi.advanceTimersByTimeAsync(500);
    expect(((await opening) as WhisperSttError).code).toBe('connect-timeout');
  });

  it('si abre a tiempo, el plazo de conexión deja de contar', async () => {
    const client = makeClient();
    const opening = client.open();
    FakeWebSocket.last().simulateOpen();
    await opening;

    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_TIMEOUT_MS * 2);
    expect(client.state).toBe('streaming');
  });

  it('un WS que abre después de vencer el plazo ya no cuenta', async () => {
    const client = makeClient();
    const opening = settled(client.open());
    const ws = FakeWebSocket.last();
    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_TIMEOUT_MS);
    await opening;

    ws.simulateOpen();
    expect(client.state).toBe('error');
    expect(client.sendChunk(chunk(1))).toBe(false);
    expect(ws.sent).toEqual([]);
  });

  it('un fallo al conectar llega con su tipo', async () => {
    const client = makeClient();
    const opening = settled(client.open());
    FakeWebSocket.last().simulateError();
    expect(((await opening) as WhisperSttError).code).toBe('connect');
  });

  it('el audio enviado mientras abre se guarda y sale en orden al abrir, antes que lo siguiente', async () => {
    const client = makeClient();
    const opening = client.open();
    const ws = FakeWebSocket.last();

    expect(client.sendChunk(chunk(1))).toBe(true);
    expect(client.sendChunk(chunk(2))).toBe(true);
    expect(ws.sent).toEqual([]);

    ws.simulateOpen();
    await opening;
    client.sendChunk(chunk(3));

    expect(binaries(ws)).toEqual([[1], [2], [3]]);
  });

  it('lo guardado tiene tope: pasado, no crece', async () => {
    const client = makeClient();
    const opening = client.open();
    const ws = FakeWebSocket.last();
    const half = new ArrayBuffer(MAX_PENDING_BYTES / 2);

    expect(client.sendChunk(half)).toBe(true);
    expect(client.sendChunk(new ArrayBuffer(MAX_PENDING_BYTES / 2))).toBe(true);
    expect(client.sendChunk(chunk(9))).toBe(false);

    ws.simulateOpen();
    await opening;
    expect(binaries(ws)).toHaveLength(2);
  });

  it('stop() mientras abre espera: al abrir envía lo guardado y después el stop', async () => {
    const client = makeClient();
    const opening = client.open();
    const ws = FakeWebSocket.last();
    client.sendChunk(chunk(7));

    const stopping = client.stop();
    expect(ws.sent).toEqual([]);

    ws.simulateOpen();
    await opening;
    expect(ws.sent.map((item) => item.kind)).toEqual(['binary', 'text']);
    expect(texts(ws)).toEqual([{ type: 'stop' }]);
    expect(client.state).toBe('stopping');

    ws.simulateMessage(JSON.stringify({ type: 'transcribed', text: 'hola', isFinal: true }));
    await expect(stopping).resolves.toBeUndefined();
  });

  it('stop() mientras abre también falla si el WS no llega a abrir', async () => {
    const client = makeClient();
    const opening = settled(client.open());
    const stopping = settled(client.stop());

    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_TIMEOUT_MS);

    expect(((await opening) as WhisperSttError).code).toBe('connect-timeout');
    expect(((await stopping) as WhisperSttError).code).toBe('connect-timeout');
  });

  it('si la transcripción final no llega a tiempo, stop() falla, avisa una vez y cierra', async () => {
    const onError = vi.fn<ErrorCallback>();
    const client = makeClient(onError);
    const opening = client.open();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    await opening;

    const stopping = settled(client.stop());
    await vi.advanceTimersByTimeAsync(DEFAULT_FINAL_TIMEOUT_MS - 1);
    expect(client.state).toBe('stopping');

    await vi.advanceTimersByTimeAsync(1);
    const err = await stopping;

    expect((err as WhisperSttError).code).toBe('final-timeout');
    expect(client.state).toBe('error');
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe('final-timeout');
  });

  it('si la transcripción llega a tiempo, el plazo final deja de contar', async () => {
    const onError = vi.fn<ErrorCallback>();
    const client = makeClient(onError);
    const opening = client.open();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    await opening;

    const stopping = client.stop();
    ws.simulateMessage(JSON.stringify({ type: 'transcribed', text: 'hola', isFinal: true }));
    await stopping;
    await vi.advanceTimersByTimeAsync(DEFAULT_FINAL_TIMEOUT_MS * 2);

    expect(client.state).toBe('closed');
    expect(onError).not.toHaveBeenCalled();
  });

  it('un error del servidor seguido del cierre avisa una sola vez', async () => {
    const onError = vi.fn<ErrorCallback>();
    const client = makeClient(onError);
    const opening = client.open();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    await opening;

    ws.simulateMessage(JSON.stringify({ type: 'error', message: 'audio demasiado largo' }));
    ws.simulateClose(1011);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('audio demasiado largo', 'server');
  });

  it('un cierre sin transcripción avisa con el tipo «closed»', async () => {
    const onError = vi.fn<ErrorCallback>();
    const client = makeClient(onError);
    const opening = client.open();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    await opening;

    ws.simulateClose(1006);
    expect(onError.mock.calls[0]?.[1]).toBe('closed');
  });

  it('abort() mientras abre suelta lo guardado, cierra y apaga los plazos', async () => {
    const client = makeClient();
    const opening = settled(client.open());
    const ws = FakeWebSocket.last();
    client.sendChunk(chunk(1));

    client.abort();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);

    // Aunque el WS llegue a abrir después, o pase el plazo, ya no hace nada.
    ws.simulateOpen();
    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_TIMEOUT_MS * 2);

    expect(client.state).toBe('closed');
    expect(ws.sent).toEqual([]);
    // Quien esperaba la apertura se entera de que ya no va a pasar.
    expect(await opening).toBeInstanceOf(Error);
  });

  it('un turno largo tiene más plazo para el final: lo que dura su audio', async () => {
    const client = makeClient();
    const opening = client.open();
    const ws = FakeWebSocket.last();
    // 2 s dichos mientras abre y 8 s después: 10 s de audio.
    client.sendChunk(new ArrayBuffer(PCM_BYTES_PER_SECOND * 2));
    ws.simulateOpen();
    await opening;
    client.sendChunk(new ArrayBuffer(PCM_BYTES_PER_SECOND * 8));

    const stopping = settled(client.stop());
    await vi.advanceTimersByTimeAsync(DEFAULT_FINAL_TIMEOUT_MS + 10_000 - 1);
    expect(client.state).toBe('stopping');

    await vi.advanceTimersByTimeAsync(1);
    expect(((await stopping) as WhisperSttError).code).toBe('final-timeout');
  });

  it('lo que llega después de abortar no se entrega', async () => {
    const onPartial = vi.fn<(text: string) => void>();
    const onFinal = vi.fn<(text: string) => void>();
    const client = new WhisperSttClient({
      url: 'ws://x:8765/stt',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onPartial,
      onFinal,
    });
    const opening = client.open();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    await opening;

    client.abort();
    // Un socket que se está cerrando aún entrega lo que venía de camino.
    ws.simulateMessage(JSON.stringify({ type: 'partial', text: 'hol' }));
    ws.simulateMessage(JSON.stringify({ type: 'transcribed', text: 'hola', isFinal: true }));

    expect(onPartial).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
    expect(client.state).toBe('closed');
  });

  it('una transcripción que llega con el plazo ya vencido no revive el turno', async () => {
    const onFinal = vi.fn<(text: string) => void>();
    const client = new WhisperSttClient({
      url: 'ws://x:8765/stt',
      webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      onFinal,
    });
    const opening = client.open();
    const ws = FakeWebSocket.last();
    ws.simulateOpen();
    await opening;

    const stopping = settled(client.stop());
    await vi.advanceTimersByTimeAsync(DEFAULT_FINAL_TIMEOUT_MS);
    await stopping;

    ws.simulateMessage(JSON.stringify({ type: 'transcribed', text: 'tarde', isFinal: true }));

    expect(onFinal).not.toHaveBeenCalled();
    expect(client.state).toBe('error');
    // Quien pregunte después sigue viendo el fallo, no una transcripción.
    expect(((await settled(client.stop())) as WhisperSttError).code).toBe('final-timeout');
  });

  it('pedir el final dos veces es la misma espera, y se pide una sola vez', async () => {
    const client = makeClient();
    const opening = client.open();
    const ws = FakeWebSocket.last();

    const first = client.stop();
    expect(client.stop()).toBe(first);

    ws.simulateOpen();
    await opening;
    expect(client.stop()).toBe(first);
    expect(texts(ws)).toEqual([{ type: 'stop' }]);

    ws.simulateMessage(JSON.stringify({ type: 'transcribed', text: 'hola', isFinal: true }));
    await expect(first).resolves.toBeUndefined();
  });
});
