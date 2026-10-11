import { describe, expect, it } from "vitest";
import { LatencyTracker, percentile } from "../app/services/latency";

describe("percentile", () => {
  it("uses nearest-rank", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("LatencyTracker", () => {
  const setup = () => {
    let t = 0;
    const tracker = new LatencyTracker(() => t, 6);
    return { tracker, advance: (ms: number) => (t += ms) };
  };

  it("measures typed message -> first model audio", () => {
    const { tracker, advance } = setup();
    tracker.textSent();
    advance(420);
    tracker.modelAudio();
    expect(tracker.summary().text).toEqual({ count: 1, p50: 420, p95: 420 });
  });

  it("measures from the LAST loud mic frame to the first model audio", () => {
    const { tracker, advance } = setup();
    tracker.micLevel(30);
    advance(100);
    tracker.micLevel(40); // still talking
    advance(50);
    tracker.micLevel(1); // silence: must not move the start time
    advance(600);
    tracker.modelAudio();
    expect(tracker.summary().voice.p50).toBe(650);
  });

  it("records only the first audio chunk of a response", () => {
    const { tracker, advance } = setup();
    tracker.textSent();
    advance(300);
    tracker.modelAudio();
    advance(20);
    tracker.modelAudio();
    expect(tracker.summary().text.count).toBe(1);
  });

  it("ignores mic energy while the model is speaking (echo) and quiet frames", () => {
    const { tracker, advance } = setup();
    tracker.setModelSpeaking(true);
    tracker.micLevel(80);
    tracker.setModelSpeaking(false);
    tracker.micLevel(2);
    advance(100);
    tracker.modelAudio();
    expect(tracker.summary().voice.count).toBe(0);
  });

  it("a typed message is not overwritten by mic noise before the answer", () => {
    const { tracker, advance } = setup();
    tracker.textSent();
    advance(100);
    tracker.micLevel(50);
    advance(200);
    tracker.modelAudio();
    expect(tracker.summary().text.p50).toBe(300);
    expect(tracker.summary().voice.count).toBe(0);
  });

  it("reset clears samples", () => {
    const { tracker } = setup();
    tracker.textSent();
    tracker.modelAudio();
    tracker.reset();
    expect(tracker.summary().text.count).toBe(0);
  });
});
