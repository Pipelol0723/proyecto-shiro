/**
 * Cliente WS hacia el microservicio Whisper (`ws://.../stt`).
 *
 * Patrón de uso por turno:
 *
 *   const client = new WhisperSttClient({ url, onPartial, onFinal, onError });
 *   await client.open();
 *   // ...mandar chunks Int16 LE mono a `client.sendChunk(buffer)`...
 *   await client.stop();       // manda `{type:'stop'}` y espera `transcribed`
 *
 * Una instancia = un turno. No reusable — al recibir `transcribed` o
 * `error` el servidor cierra; el cliente queda en estado terminal.
 * Crear uno nuevo en el siguiente turno mantiene el código simple y
 * coincide con la coreografía descrita en ADR 0019 (decisión 3).
 *
 * No es un transport del EventBus — vive aparte del `WebSocketTransport`
 * del core porque su payload es binario (audio crudo) y su protocolo es
 * de aplicación (partial/transcribed/error), no envelopes wire. El
 * hook PTT (`useMicrophonePTT`) actúa de puente: traduce los callbacks
 * de aquí en emits del bus (`stt:partial`, `stt:transcribed`).
 */

const PARTIAL = 'partial';
const TRANSCRIBED = 'transcribed';
const ERROR_MSG = 'error';

interface WhisperServerPartial {
  type: 'partial';
  text: string;
}

interface WhisperServerTranscribed {
  type: 'transcribed';
  text: string;
  isFinal: true;
}

interface WhisperServerError {
  type: 'error';
  message: string;
}

type WhisperServerMessage = WhisperServerPartial | WhisperServerTranscribed | WhisperServerError;

function parseServerMessage(raw: string): WhisperServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as { type?: unknown; text?: unknown; message?: unknown; isFinal?: unknown };
  if (obj.type === PARTIAL && typeof obj.text === 'string') {
    return { type: 'partial', text: obj.text };
  }
  if (obj.type === TRANSCRIBED && typeof obj.text === 'string' && obj.isFinal === true) {
    return { type: 'transcribed', text: obj.text, isFinal: true };
  }
  if (obj.type === ERROR_MSG && typeof obj.message === 'string') {
    return { type: 'error', message: obj.message };
  }
  return null;
}

export interface WhisperSttClientOptions {
  /** URL del WS, e.g. `ws://localhost:8765/stt`. */
  url: string;
  /** Texto parcial — reemplaza el partial anterior. */
  onPartial?: (text: string) => void;
  /** Texto definitivo del turno. Después de esto el WS cierra. */
  onFinal?: (text: string) => void;
  /**
   * Cualquier fallo del lado server o del transporte. La conexión queda
   * cerrada tras invocar este callback.
   */
  onError?: (reason: string) => void;
  /** Permite inyectar un constructor de WS en tests. */
  webSocketCtor?: new (url: string) => WebSocket;
}

export type WhisperSttClientState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'stopping'
  | 'closed'
  | 'error';

export class WhisperSttClient {
  private readonly url: string;
  private readonly Ctor: new (url: string) => WebSocket;
  private readonly onPartial: ((text: string) => void) | undefined;
  private readonly onFinal: ((text: string) => void) | undefined;
  private readonly onError: ((reason: string) => void) | undefined;
  private ws: WebSocket | null = null;
  private _state: WhisperSttClientState = 'idle';
  /**
   * Estado terminal del turno. Cachear el resultado evita crear una
   * `Promise` interna que pueda quedar sin handler — si el caller nunca
   * llama a `stop()`, no hay promise huérfana que dispare unhandled
   * rejection cuando un `error` o un cierre temprano llegan.
   */
  private terminal:
    | { kind: 'pending' }
    | { kind: 'final'; text: string }
    | { kind: 'failed'; reason: string } = { kind: 'pending' };
  /** Settle del `stop()` actual, si hay alguno esperando. */
  private stopResolve: (() => void) | null = null;
  private stopReject: ((err: Error) => void) | null = null;

  constructor(opts: WhisperSttClientOptions) {
    this.url = opts.url;
    this.Ctor = opts.webSocketCtor ?? WebSocket;
    this.onPartial = opts.onPartial;
    this.onFinal = opts.onFinal;
    this.onError = opts.onError;
  }

  get state(): WhisperSttClientState {
    return this._state;
  }

  /** Abre el WS. Resuelve cuando está `open`; rechaza si falla la conexión. */
  open(): Promise<void> {
    if (this._state !== 'idle') {
      return Promise.reject(new Error(`WhisperSttClient.open en estado ${this._state}`));
    }
    this._state = 'connecting';

    return new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new this.Ctor(this.url);
      } catch (err) {
        this._state = 'error';
        const reason = err instanceof Error ? err.message : String(err);
        reject(new Error(`no se pudo crear WS: ${reason}`));
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.addEventListener('open', () => {
        this._state = 'streaming';
        resolve();
      });

      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return; // chunks binarios no llegan del server
        const msg = parseServerMessage(event.data);
        if (msg === null) return;
        if (msg.type === 'partial') {
          this.onPartial?.(msg.text);
          return;
        }
        if (msg.type === 'transcribed') {
          this._state = 'closed';
          this.terminal = { kind: 'final', text: msg.text };
          this.onFinal?.(msg.text);
          this.stopResolve?.();
          return;
        }
        // error
        this._state = 'error';
        this.terminal = { kind: 'failed', reason: msg.message };
        this.onError?.(msg.message);
        this.stopReject?.(new Error(msg.message));
      });

      ws.addEventListener('error', () => {
        if (this._state === 'connecting') {
          this._state = 'error';
          reject(new Error(`fallo al conectar a ${this.url}`));
          return;
        }
        // Si ya estábamos streaming/stopping, el `close` siguiente
        // determinará si fue cierre limpio o no.
      });

      ws.addEventListener('close', (ev) => {
        if (this._state === 'closed') return; // fue cierre limpio post-transcribed
        if (this._state === 'connecting') {
          this._state = 'error';
          reject(new Error(`conexión cerrada antes de open (code=${ev.code})`));
          return;
        }
        // Cierre sin haber recibido `transcribed`: error.
        this._state = 'error';
        const reason = `WS cerrado sin transcripción final (code=${ev.code})`;
        this.terminal = { kind: 'failed', reason };
        this.onError?.(reason);
        this.stopReject?.(new Error(reason));
      });
    });
  }

  /**
   * Envía un chunk de audio PCM Int16 LE mono. Sin efecto si el cliente
   * no está en `streaming`. Devolver al caller si se envió ayuda a evitar
   * que el productor (worklet) acumule chunks tras un cierre inesperado.
   */
  sendChunk(buffer: ArrayBuffer): boolean {
    if (this._state !== 'streaming' || this.ws === null) return false;
    this.ws.send(buffer);
    return true;
  }

  /**
   * Manda `{type:'stop'}` al servidor y espera el `transcribed` final.
   * Resuelve cuando llega; rechaza si el servidor cierra antes o emite
   * un error.
   */
  stop(): Promise<void> {
    // Si ya tenemos resultado terminal cacheado, settle inmediatamente.
    if (this.terminal.kind === 'final') return Promise.resolve();
    if (this.terminal.kind === 'failed') return Promise.reject(new Error(this.terminal.reason));
    if (this._state === 'closed') return Promise.resolve();
    if (this._state === 'error') return Promise.reject(new Error('cliente en estado error'));
    if (this._state !== 'streaming') {
      return Promise.reject(new Error(`stop() en estado ${this._state}`));
    }
    this._state = 'stopping';
    this.ws?.send(JSON.stringify({ type: 'stop' }));
    return new Promise<void>((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
    });
  }

  /**
   * Aborta el turno sin esperar transcripción. Útil si el usuario cancela
   * (suelta la tecla sin hablar, o cambia de pantalla mientras habla).
   */
  abort(): void {
    if (this._state === 'closed' || this._state === 'error') return;
    this._state = 'closed';
    this.terminal = { kind: 'final', text: '' };
    this.ws?.close();
    this.stopResolve?.();
  }
}
