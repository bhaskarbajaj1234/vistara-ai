export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code, reason, wasClean: true }));
  }

  // ---- helpers that play the role of the server ----
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverSend(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverClose(code: number, reason: string) {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: false });
  }
  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
  static reset() {
    FakeWebSocket.instances = [];
  }
}

/** Let queued promise callbacks (the socket's ordered inbox) run. */
export const flushPromises = async () => {
  // Microtask-only (no timers), so it also works under vi.useFakeTimers().
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
