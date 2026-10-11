import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiWebSocket, type CloseInfo } from "../app/services/geminiWebSocket";
import type { ServerEvent } from "../app/services/liveProtocol";
import { FakeWebSocket, flushPromises } from "./helpers";

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

const make = () => {
  const events: ServerEvent[] = [];
  const closes: CloseInfo[] = [];
  const onSetupComplete = vi.fn();
  const client = new GeminiWebSocket({ onSetupComplete, onEvent: (e) => events.push(e), onClose: (i) => closes.push(i) });
  client.connect({ token: "auth_tokens/t", model: "gemini-3.8-live" });
  const ws = FakeWebSocket.instances[0] as FakeWebSocket;
  return { client, ws, events, closes, onSetupComplete };
};

describe("GeminiWebSocket", () => {
  it("sends the setup message as soon as the socket opens", () => {
    const { ws } = make();
    ws.open();
    const [setup] = ws.sentJson() as Array<{ setup: { model: string; inputAudioTranscription: object; outputAudioTranscription: object } }>;
    expect(setup?.setup.model).toBe("models/gemini-3.8-live");
    expect(setup?.setup.inputAudioTranscription).toEqual({});
    expect(setup?.setup.outputAudioTranscription).toEqual({});
  });

  it("refuses to send media until setupComplete arrives", async () => {
    const { client, ws, onSetupComplete } = make();
    ws.open();
    expect(client.sendAudio("QQ==")).toBe(false);
    expect(client.sendText("hi")).toBe(false);

    ws.serverSend({ setupComplete: {} });
    await flushPromises();
    expect(onSetupComplete).toHaveBeenCalledTimes(1);
    expect(client.isReady).toBe(true);

    expect(client.sendAudio("QQ==")).toBe(true);
    expect(client.sendVideo("QQ==")).toBe(true);
    expect(client.sendText("hi")).toBe(true);
    const kinds = ws.sentJson().slice(1).map((m) => Object.keys((m as { realtimeInput: object }).realtimeInput)[0]);
    expect(kinds).toEqual(["audio", "video", "text"]);
  });

  it("delivers events in arrival order even when frames are async Blobs", async () => {
    const { ws, events } = make();
    ws.open();
    const big = new Blob([JSON.stringify({ serverContent: { outputTranscription: { text: "first" } } })]);
    const small = JSON.stringify({ serverContent: { outputTranscription: { text: "second" } } });
    ws.onmessage?.({ data: big });
    ws.onmessage?.({ data: small });
    await new Promise((r) => setTimeout(r, 10));
    expect(events.map((e) => (e.type === "outputTranscript" ? e.text : ""))).toEqual(["first", "second"]);
  });

  it("reports close details, including whether setup had completed", async () => {
    const { ws, closes } = make();
    ws.open();
    ws.serverClose(1008, "token expired");
    expect(closes[0]).toMatchObject({ code: 1008, reason: "token expired", hadSetup: false });
  });

  it("close() closes the underlying socket once", () => {
    const { client, ws } = make();
    ws.open();
    const spy = vi.spyOn(ws, "close");
    client.close();
    client.close();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
