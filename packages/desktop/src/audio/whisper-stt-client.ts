/**
 * Cliente WS hacia el microservicio Whisper (`ws://.../stt`).
 *
 * Patrón de uso por turno:
 *
 *   const client = new WhisperSttClient({ url, onPartial, onFinal, onError });
 *   const opened = client.open();   // no hace falta esperarlo para enviar
 *   // ...mandar chunks Int16 LE mono a `client.sendChunk(buffer)`...
 *   await client.stop();            // manda `{type:'stop'}` y espera `transcribed`
 *
 * Una instancia = un turno. No reusable — al recibir `transcribed` o
 * `error` el servidor cierra; el cliente queda en estado terminal.
 * Crear uno nuevo en el siguiente turno mantiene el código simple y
 * coincide con la coreografía descrita en ADR 0019 (decisión 3).
 *
 * **Nada se queda esperando para siempre** (R-322): abrir tiene un plazo y
 * la transcripción final, otro. Con Whisper apagado en otro equipo, sin
 * ellos el turno seguía colgado hasta el timeout de TCP, con el micro abierto.
 *
 * **Lo dicho mientras abre no se pierde** (R-143): los trozos que llegan
 * antes de que el WS esté abierto se guardan y salen, en orden, al abrir. Un
 * `stop()` en ese rato también espera su turno.
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

/** Plazo para que el WS abra. Con Whisper en marcha en local tarda milisegundos. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
/** Plazo para la transcripción final tras pedirla. Una frase larga en CPU tarda varios segundos. */
export const DEFAULT_FINAL_TIMEOUT_MS = 15_000;
/** Audio que se guarda como mucho mientras el WS abre: unos 5 s de PCM a 16 kHz. */
export const MAX_PENDING_BYTES = 16_000 * 2 * 5;

/**
 * Por qué falló el turno:
 *
 * - `connect`: el WS no llegó a abrir (rechazado o cerrado antes).
 * - `connect-timeout`: no abrió dentro del plazo.
 * - `final-timeout`: se pidió la transcripción final y no llegó a tiempo.
 * - `closed`: el WS se cerró a mitad, sin transcripción final.
 * - `server`: el servicio contestó con un error.
 */
export type SttFailureCode = 'connect' | 'connect-timeout' | 'final-timeout' | 'closed' | 'server';

export class WhisperSttError extends Error {
  readonly code: SttFailureCode;

  constructor(code: SttFailureCode, message: string) {
    super(message);
    this.name = 'WhisperSttError';
    this.code = code;
  }
}

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
   * Un fallo con el turno ya en marcha: error del servidor, cierre a mitad o
   * transcripción final que no llega. La conexión queda cerrada. Los fallos
   * al abrir no pasan por aquí: los da el rechazo de `open()`.
   */
  onError?: (reason: string, code: SttFailureCode) => void;
  /** Plazo de apertura del WS. Por defecto, `DEFAULT_CONNECT_TIMEOUT_MS`. */
  connectTimeoutMs?: number;
  /** Plazo de la transcripción final. Por defecto, `DEFAULT_FINAL_TIMEOUT_MS`. */
  finalTimeoutMs?: number;
  /** Permite inyectar un constructor de WS en tests. */
  webSocketCtor?: new (url: string) => WebSocket;
}

export type WhisperSttClientState =
  'idle' | 'connecting' | 'streaming' | 'stopping' | 'closed' | 'error';

export class WhisperSttClient {
  private readonly url: string;
  private readonly Ctor: new (url: string) => WebSocket;
  private readonly onPartial: ((text: string) => void) | undefined;
  private readonly onFinal: ((text: string) => void) | undefined;
  private readonly onError: ((reason: string, code: SttFailureCode) => void) | undefined;
  private readonly connectTimeoutMs: number;
  private readonly finalTimeoutMs: number;
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
    | { kind: 'failed'; error: WhisperSttError } = { kind: 'pending' };
  /** Settle del `stop()` actual, si hay alguno esperando. */
  private stopResolve: (() => void) | null = null;
  private stopReject: ((err: Error) => void) | null = null;
  /** Rechazo del `open()` en curso, para cuando se aborta o vence su plazo. */
  private openReject: ((err: Error) => void) | null = null;
  /** Audio recibido mientras el WS abre. */
  private pending: ArrayBuffer[] = [];
  private pendingBytes = 0;
  /** Se pidió `stop()` antes de que el WS abriera. */
  private stopRequested = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: WhisperSttClientOptions) {
    this.url = opts.url;
    this.Ctor = opts.webSocketCtor ?? WebSocket;
    this.onPartial = opts.onPartial;
    this.onFinal = opts.onFinal;
    this.onError = opts.onError;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.finalTimeoutMs = opts.finalTimeoutMs ?? DEFAULT_FINAL_TIMEOUT_MS;
  }

  get state(): WhisperSttClientState {
    return this._state;
  }

  /**
   * Abre el WS. Resuelve cuando está `open`; rechaza con un `WhisperSttError`
   * si falla la conexión, si no abre dentro del plazo o si se aborta antes.
   */
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
        const reason = err instanceof Error ? err.message : String(err);
        const error = new WhisperSttError('connect', `no se pudo crear WS: ${reason}`);
        this._state = 'error';
        this.terminal = { kind: 'failed', error };
        reject(error);
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      this.openReject = reject;

      this.connectTimer = setTimeout(() => {
        this.failConnect(
          new WhisperSttError(
            'connect-timeout',
            `Whisper no abrió la conexión en ${String(this.connectTimeoutMs)} ms`,
          ),
        );
      }, this.connectTimeoutMs);

      ws.addEventListener('open', () => {
        // Abrió tarde (venció el plazo) o después de un abort: ya no cuenta.
        if (this._state !== 'connecting') return;
        this.clearConnectTimer();
        this.openReject = null;
        this._state = 'streaming';
        // Primero lo que se dijo mientras abría, en orden.
        for (const chunk of this.pending) ws.send(chunk);
        this.dropPending();
        resolve();
        if (this.stopRequested) this.sendStop();
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
          this.clearFinalTimer();
          this._state = 'closed';
          this.terminal = { kind: 'final', text: msg.text };
          this.onFinal?.(msg.text);
          this.stopResolve?.();
          return;
        }
        this.failTurn(new WhisperSttError('server', msg.message));
      });

      ws.addEventListener('error', () => {
        this.failConnect(new WhisperSttError('connect', `fallo al conectar a ${this.url}`));
        // Si ya estábamos streaming/stopping, el `close` siguiente
        // determinará si fue cierre limpio o no.
      });

      ws.addEventListener('close', (ev) => {
        // Cierre limpio tras `transcribed`, o de un turno que ya falló o se abortó.
        if (this._state === 'closed' || this._state === 'error') return;
        if (this._state === 'connecting') {
          this.failConnect(
            new WhisperSttError(
              'connect',
              `conexión cerrada antes de open (code=${String(ev.code)})`,
            ),
          );
          return;
        }
        this.failTurn(
          new WhisperSttError(
            'closed',
            `WS cerrado sin transcripción final (code=${String(ev.code)})`,
          ),
        );
      });
    });
  }

  /**
   * Envía un chunk de audio PCM Int16 LE mono. Mientras el WS abre, lo guarda
   * para enviarlo al abrir. Devuelve `false` si el chunk se descarta: el turno
   * ya terminó, aún no empezó, o lo guardado llegó a su tope.
   */
  sendChunk(buffer: ArrayBuffer): boolean {
    if (this._state === 'streaming' && this.ws !== null) {
      this.ws.send(buffer);
      return true;
    }
    if (this._state !== 'connecting') return false;
    if (this.pendingBytes + buffer.byteLength > MAX_PENDING_BYTES) return false;
    this.pending.push(buffer);
    this.pendingBytes += buffer.byteLength;
    return true;
  }

  /**
   * Manda `{type:'stop'}` al servidor y espera el `transcribed` final. Si el
   * WS aún está abriendo, lo manda en cuanto abra, después de lo guardado.
   * Resuelve cuando llega la transcripción; rechaza con un `WhisperSttError`
   * si el servidor cierra antes, emite un error, o no contesta a tiempo.
   */
  stop(): Promise<void> {
    // Si ya tenemos resultado terminal cacheado, settle inmediatamente.
    if (this.terminal.kind === 'final') return Promise.resolve();
    if (this.terminal.kind === 'failed') return Promise.reject(this.terminal.error);
    if (this._state === 'closed') return Promise.resolve();
    if (this._state === 'error') return Promise.reject(new Error('cliente en estado error'));
    if (this._state !== 'streaming' && this._state !== 'connecting') {
      return Promise.reject(new Error(`stop() en estado ${this._state}`));
    }
    const settled = new Promise<void>((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
    });
    if (this._state === 'connecting') this.stopRequested = true;
    else this.sendStop();
    return settled;
  }

  /**
   * Aborta el turno sin esperar transcripción. Útil si el usuario cancela
   * (suelta la tecla sin hablar, o cambia de pantalla mientras habla).
   */
  abort(): void {
    if (this._state === 'closed' || this._state === 'error') return;
    const wasConnecting = this._state === 'connecting';
    this.clearConnectTimer();
    this.clearFinalTimer();
    this.dropPending();
    this._state = 'closed';
    this.terminal = { kind: 'final', text: '' };
    this.ws?.close();
    this.stopResolve?.();
    if (wasConnecting) {
      this.openReject?.(new WhisperSttError('closed', 'turno abortado antes de abrir el WS'));
      this.openReject = null;
    }
  }

  // ── interno ────────────────────────────────────────────────────────────────

  /** Pide la transcripción final y pone en marcha su plazo. */
  private sendStop(): void {
    this._state = 'stopping';
    this.ws?.send(JSON.stringify({ type: 'stop' }));
    this.finalTimer = setTimeout(() => {
      if (this._state !== 'stopping') return;
      this.failTurn(
        new WhisperSttError(
          'final-timeout',
          `Whisper no devolvió la transcripción en ${String(this.finalTimeoutMs)} ms`,
        ),
      );
    }, this.finalTimeoutMs);
  }

  /** El WS no llegó a abrir. Lo cuenta `open()`, no `onError`. */
  private failConnect(error: WhisperSttError): void {
    if (this._state !== 'connecting') return;
    this.clearConnectTimer();
    this.dropPending();
    this._state = 'error';
    this.terminal = { kind: 'failed', error };
    this.closeSocket();
    this.openReject?.(error);
    this.openReject = null;
    this.stopReject?.(error);
  }

  /** El turno falló con el WS ya abierto. */
  private failTurn(error: WhisperSttError): void {
    if (this._state === 'closed' || this._state === 'error') return;
    this.clearFinalTimer();
    this._state = 'error';
    this.terminal = { kind: 'failed', error };
    this.closeSocket();
    this.onError?.(error.message, error.code);
    this.stopReject?.(error);
  }

  private closeSocket(): void {
    try {
      this.ws?.close();
    } catch {
      // Ya cerrado o en un estado en el que no se puede cerrar: da igual.
    }
  }

  private dropPending(): void {
    this.pending = [];
    this.pendingBytes = 0;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private clearFinalTimer(): void {
    if (this.finalTimer !== null) clearTimeout(this.finalTimer);
    this.finalTimer = null;
  }
}
