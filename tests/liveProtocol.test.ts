import { describe, expect, it } from "vitest";
import { buildAudioMessage, buildLiveUrl, buildSetupMessage, buildTextMessage, buildVideoMessage, nextBackoffMs, parseServerMessage } from "../app/services/liveProtocol";

describe("parseServerMessage", () => {
  it("recognises setupComplete", () => {
    expect(parseServerMessage('{"setupComplete":{}}')).toEqual([{ type: "setupComplete" }]);
  });

  it("extracts model audio, ignoring non-audio parts", () => {
    const raw = JSON.stringify({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "QUJD" } }, { inlineData: { mimeType: "image/png", data: "x" } }] } },
    });
    expect(parseServerMessage(raw)).toEqual([{ type: "audio", data: "QUJD" }]);
  });

  it("extracts both transcription streams", () => {
    expect(parseServerMessage('{"serverContent":{"inputTranscription":{"text":"hello"}}}')).toEqual([{ type: "inputTranscript", text: "hello" }]);
    expect(parseServerMessage('{"serverContent":{"outputTranscription":{"text":" there"}}}')).toEqual([{ type: "outputTranscript", text: " there" }]);
  });

  it("handles interrupted and turnComplete flags", () => {
    expect(parseServerMessage('{"serverContent":{"interrupted":true}}')).toEqual([{ type: "interrupted" }]);
    expect(parseServerMessage('{"serverContent":{"turnComplete":true}}')).toEqual([{ type: "turnComplete" }]);
  });

  it("emits several events from one message in a stable order (audio, transcript, then turnComplete)", () => {
    const raw = JSON.stringify({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } }] },
        outputTranscription: { text: "Hi" },
        turnComplete: true,
      },
    });
    expect(parseServerMessage(raw).map((e) => e.type)).toEqual(["audio", "outputTranscript", "turnComplete"]);
  });

  it("parses session resumption updates and goAway", () => {
    expect(parseServerMessage('{"sessionResumptionUpdate":{"newHandle":"h1","resumable":true}}')).toEqual([{ type: "resumptionUpdate", handle: "h1", resumable: true }]);
    expect(parseServerMessage('{"goAway":{"timeLeft":"30s"}}')).toEqual([{ type: "goAway", timeLeft: "30s" }]);
  });

  it("returns nothing for invalid JSON or unknown messages", () => {
    expect(parseServerMessage("not json")).toEqual([]);
    expect(parseServerMessage("{}")).toEqual([]);
  });
});

describe("message builders", () => {
  it("builds a setup message with transcription, resumption and the models/ prefix", () => {
    const { setup } = buildSetupMessage({ model: "gemini-3.8-live" });
    expect(setup.model).toBe("models/gemini-3.8-live");
    expect(setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.sessionResumption).toEqual({});
  });

  it("does not double the models/ prefix and passes a resume handle", () => {
    const { setup } = buildSetupMessage({ model: "models/x", resumeHandle: "abc" });
    expect(setup.model).toBe("models/x");
    expect(setup.sessionResumption).toEqual({ handle: "abc" });
  });

  it("builds media and text messages", () => {
    expect(buildAudioMessage("QQ==")).toEqual({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: "QQ==" } } });
    expect(buildVideoMessage("QQ==")).toEqual({ realtimeInput: { video: { mimeType: "image/jpeg", data: "QQ==" } } });
    expect(buildTextMessage("hi")).toEqual({ realtimeInput: { text: "hi" } });
  });

  it("uses the constrained v1alpha endpoint with access_token for ephemeral tokens", () => {
    const url = buildLiveUrl("auth_tokens/abc");
    expect(url).toContain("v1alpha.GenerativeService.BidiGenerateContentConstrained");
    expect(url).toContain("?access_token=auth_tokens/abc");
    expect(url).not.toContain("key=");
  });
});

describe("nextBackoffMs", () => {
  const noJitter = () => 0.5; // jitter factor exactly 1.0
  it("doubles each attempt and caps at the maximum", () => {
    expect([1, 2, 3, 4, 5, 6].map((a) => nextBackoffMs(a, 1000, 16000, noJitter))).toEqual([1000, 2000, 4000, 8000, 16000, 16000]);
  });
  it("applies +/-25% jitter", () => {
    expect(nextBackoffMs(1, 1000, 16000, () => 0)).toBe(750);
    expect(nextBackoffMs(1, 1000, 16000, () => 1)).toBe(1250);
  });
});
