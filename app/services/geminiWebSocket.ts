import {
  buildAudioMessage,
  buildLiveUrl,
  buildSetupMessage,
  buildTextMessage,
  buildVideoMessage,
  parseServerMessage,
  type ServerEvent,
} from "./liveProtocol";

export interface CloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
  /** True if setupComplete had been received before the socket closed. */
  hadSetup: boolean;
}

export interface SocketHandlers {
  onSetupComplete: () => void;
  onEvent: (event: ServerEvent) => void;
  onClose: (info: CloseInfo) => void;
}

export interface ConnectOptions {
  token: string;
  model: string;
  resumeHandle?: string | null;
}

/**
 * Thin client for one Gemini Live WebSocket session.
 *
 *  - Sends the `setup` message when the socket opens.
 *  - Refuses to send media until the server answers `setupComplete`.
 *  - Decodes server frames (binary Blob or text) strictly in arrival order.
 */
export class GeminiWebSocket {
  private ws: WebSocket | null = null;
  private ready = false;
  // Blob decoding is async; chaining keeps events in the order the server sent them.
  private inbox: Promise<void> = Promise.resolve();

  constructor(
    private readonly handlers: SocketHandlers,
    private readonly WebSocketImpl: typeof WebSocket = WebSocket,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  connect(options: ConnectOptions): void {
    const ws = new this.WebSocketImpl(buildLiveUrl(options.token));
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(buildSetupMessage({ model: options.model, resumeHandle: options.resumeHandle })));
    };

    ws.onmessage = (event: MessageEvent) => {
      this.inbox = this.inbox.then(() => this.processFrame(event.data)).catch((error) => {
        console.error("[live] failed to process a server message", error);
      });
    };

    ws.onerror = () => {
      // The browser gives no detail on socket errors; the close event that follows carries the code/reason.
      console.warn("[live] WebSocket error");
    };

    ws.onclose = (event: CloseEvent) => {
      const hadSetup = this.ready;
      this.ready = false;
      this.handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean, hadSetup });
    };
  }

  private async processFrame(data: unknown): Promise<void> {
    const text = data instanceof Blob ? await data.text() : typeof data === "string" ? data : "";
    for (const event of parseServerMessage(text)) {
      if (event.type === "setupComplete") {
        this.ready = true;
        this.handlers.onSetupComplete();
      }
      this.handlers.onEvent(event);
    }
  }

  private send(payload: object): boolean {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  sendAudio(b64: string): boolean {
    return this.send(buildAudioMessage(b64));
  }

  sendVideo(b64: string): boolean {
    return this.send(buildVideoMessage(b64));
  }

  sendText(text: string): boolean {
    return this.send(buildTextMessage(text));
  }

  close(code = 1000, reason = "client closing"): void {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(code, reason);
    }
  }
}
