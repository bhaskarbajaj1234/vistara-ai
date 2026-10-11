import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../app/services/liveSession";
import { FakeWebSocket, flushPromises } from "./helpers";

const mocks = vi.hoisted(() => ({
  mic: { options: undefined as undefined | { onChunk: (b64: string, level: number) => void }, muted: false },
  frames: { onFrame: undefined as undefined | ((b64: string) => void), stop: undefined as undefined | (() => void) },
  player: { enqueue: undefined as undefined | (() => void), interrupt: undefined as undefined | (() => void) },
}));

vi.mock("../app/services/audioPlayer", () => ({
  AudioPlayer: class {
    prepare = vi.fn();
    enqueue = vi.fn().mockResolvedValue(undefined);
    interrupt = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
    constructor() {
      mocks.player.enqueue = this.enqueue as unknown as () => void;
      mocks.player.interrupt = this.interrupt as unknown as () => void;
    }
  },
}));

vi.mock("../app/services/micCapture", () => ({
  MicCapture: class {
    prepare = vi.fn();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    setMuted = (m: boolean) => {
      mocks.mic.muted = m;
    };
    get isMuted() {
      return mocks.mic.muted;
    }
    constructor(options: { onChunk: (b64: string, level: number) => void }) {
      mocks.mic.options = options;
    }
  },
}));

vi.mock("../app/services/videoFrames", () => ({
  startFrameCapture: (_video: unknown, onFrame: (b64: string) => void) => {
    mocks.frames.onFrame = onFrame;
    mocks.frames.stop = vi.fn();
    return mocks.frames.stop;
  },
}));

import { LiveSession } from "../app/services/liveSession";

const video = () => ({ srcObject: null as unknown, muted: false, play: vi.fn().mockResolvedValue(undefined) }) as unknown as HTMLVideoElement;
const trackStop = vi.fn();

function setup() {
  const statuses: Array<{ status: SessionStatus; error: string | null }> = [];
  const handlers = {
    onStatus: vi.fn((status: SessionStatus, error: string | null) => statuses.push({ status, error })),
    onMessages: vi.fn(),
    onModelSpeaking: vi.fn(),
    onStats: vi.fn(),
  };
  const fetchToken = vi.fn().mockResolvedValue({ token: "auth_tokens/one", model: "gemini-3.8-live" });
  const session = new LiveSession(handlers, fetchToken);
  return { session, handlers, statuses, fetchToken, last: () => statuses[statuses.length - 1]?.status };
}

async function goLive(ctx: ReturnType<typeof setup>, index = 0) {
  await vi.waitFor(() => expect(FakeWebSocket.instances[index]).toBeDefined());
  const ws = FakeWebSocket.instances[index] as FakeWebSocket;
  ws.open();
  ws.serverSend({ setupComplete: {} });
  await flushPromises();
  expect(ctx.last()).toBe("live");
  return ws;
}

beforeEach(() => {
  FakeWebSocket.reset();
  mocks.mic.muted = false;
  trackStop.mockClear();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveSession", () => {
  it("starts devices, gets a token, connects and goes live after setupComplete", async () => {
    const ctx = setup();
    await ctx.session.start(video());
    expect(ctx.fetchToken).toHaveBeenCalledTimes(1);
    const ws = await goLive(ctx);
    expect(ws.url).toContain("BidiGenerateContentConstrained?access_token=auth_tokens/one");
    expect(ctx.statuses.map((s) => s.status)).toEqual(["starting", "connecting", "live"]);
    await ctx.session.stop();
  });

  it("streams mic audio, video frames and typed text once live", async () => {
    const ctx = setup();
    await ctx.session.start(video());
    const ws = await goLive(ctx);

    mocks.mic.options?.onChunk("QUJD", 40);
    mocks.frames.onFrame?.("SlBFRw==");
    expect(ctx.session.sendText("  hello  ")).toBe(true);

    const input = ws.sentJson().slice(1).map((m) => (m as { realtimeInput: Record<string, unknown> }).realtimeInput);
    expect(Object.keys(input[0] ?? {})).toEqual(["audio"]);
    expect(Object.keys(input[1] ?? {})).toEqual(["video"]);
    expect(input[2]).toEqual({ text: "hello" });
    await ctx.session.stop();
  });

  it("does not send mic audio while muted", async () => {
    const ctx = setup();
    await ctx.session.start(video());
    const ws = await goLive(ctx);
    ctx.session.setMuted(true);
    mocks.mic.options?.onChunk("QUJD", 40);
    expect(ws.sent).toHaveLength(1); // only the setup message
    await ctx.session.stop();
  });

  it("builds merged captions for both speakers from server events", async () => {
    const ctx = setup();
    await ctx.session.start(video());
    const ws = await goLive(ctx);

    ws.serverSend({ serverContent: { inputTranscription: { text: "What is" } } });
    ws.serverSend({ serverContent: { inputTranscription: { text: " this?" } } });
    ws.serverSend({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } }] }, outputTranscription: { text: "A mug." }, turnComplete: true } });
    await flushPromises();

    const messages = ctx.handlers.onMessages.mock.calls.at(-1)?.[0] as Array<{ role: string; text: string; final: boolean }>;
    expect(messages.map((m) => [m.role, m.text, m.final])).toEqual([
      ["user", "What is this?", true],
      ["model", "A mug.", true],
    ]);
    expect(mocks.player.enqueue).toHaveBeenCalledTimes(1);
    await ctx.session.stop();
  });

  it("stops playback and marks the bubble when the model is interrupted", async () => {
    const ctx = setup();
    await ctx.session.start(video());
    const ws = await goLive(ctx);
    ws.serverSend({ serverContent: { outputTranscription: { text: "Let me expl" } } });
    ws.serverSend({ serverContent: { interrupted: true } });
    await flushPromises();
    expect(mocks.player.interrupt).toHaveBeenCalled();
    const messages = ctx.handlers.onMessages.mock.calls.at(-1)?.[0] as Array<{ interrupted?: boolean }>;
    expect(messages[0]?.interrupted).toBe(true);
    await ctx.session.stop();
  });

  it("reconnects after an unexpected close, with a fresh token and the saved resumption handle", async () => {
    vi.useFakeTimers();
    const ctx = setup();
    ctx.fetchToken.mockResolvedValueOnce({ token: "auth_tokens/one", model: "gemini-3.8-live" }).mockResolvedValueOnce({ token: "auth_tokens/two", model: "gemini-3.8-live" });
    await ctx.session.start(video());
    const first = await goLive(ctx);
    first.serverSend({ sessionResumptionUpdate: { newHandle: "handle-42", resumable: true } });
    await flushPromises();

    first.serverClose(1006, "network drop");
    await flushPromises();
    expect(ctx.last()).toBe("reconnecting");
    expect(mocks.frames.stop).toHaveBeenCalled(); // video stopped while disconnected

    await vi.advanceTimersByTimeAsync(2000);
    const second = await goLive(ctx, 1);
    expect(ctx.fetchToken).toHaveBeenCalledTimes(2);
    expect(second.url).toContain("auth_tokens/two");
    const setupMessage = second.sentJson()[0] as { setup: { sessionResumption: { handle?: string } } };
    expect(setupMessage.setup.sessionResumption.handle).toBe("handle-42");
    await ctx.session.stop();
  });

  it("gives up with a clear error after repeated failures", async () => {
    vi.useFakeTimers();
    const ctx = setup();
    await ctx.session.start(video());
    const first = await goLive(ctx);
    ctx.fetchToken.mockRejectedValue(new Error("token service down"));
    first.serverClose(1006, "network drop");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ctx.last()).toBe("error");
    expect(ctx.statuses.at(-1)?.error).toContain("Connection lost");
    expect(trackStop).toHaveBeenCalled(); // camera/mic released
  });

  it("fails immediately (no retry loop) if the server rejects the very first connection", async () => {
    const ctx = setup();
    await ctx.session.start(video());
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]).toBeDefined());
    const ws = FakeWebSocket.instances[0] as FakeWebSocket;
    ws.open();
    ws.serverClose(1007, "invalid model");
    await vi.waitFor(() => expect(ctx.last()).toBe("error"));
    expect(ctx.statuses.at(-1)?.error).toContain("invalid model");
    expect(ctx.fetchToken).toHaveBeenCalledTimes(1);
  });

  it("reports a friendly message when camera/mic permission is denied", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
    });
    const ctx = setup();
    await ctx.session.start(video());
    expect(ctx.last()).toBe("error");
    expect(ctx.statuses.at(-1)?.error).toBe("Camera and microphone permission was denied.");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("stop() closes the socket, releases the camera and returns to idle", async () => {
    const ctx = setup();
    await ctx.session.start(video());
    const ws = await goLive(ctx);
    await ctx.session.stop();
    expect(ws.readyState).toBe(3);
    expect(trackStop).toHaveBeenCalled();
    expect(ctx.last()).toBe("idle");
    expect(ctx.session.sendText("late")).toBe(false);
  });
});
