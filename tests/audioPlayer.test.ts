import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "../app/services/audioPlayer";
import { arrayBufferToBase64, float32ToPcm16 } from "../app/utils/audioUtils";

interface FakeSource {
  buffer: { duration: number } | null;
  startedAt: number | null;
  stopped: boolean;
  onended: (() => void) | null;
  connect: () => void;
  start: (when: number) => void;
  stop: () => void;
}

function makeContext() {
  const sources: FakeSource[] = [];
  const ctx = {
    state: "running",
    currentTime: 10,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockImplementation(async () => {
      ctx.state = "closed";
    }),
    createBuffer: (_channels: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: vi.fn() }),
    createBufferSource: () => {
      const s: FakeSource = {
        buffer: null,
        startedAt: null,
        stopped: false,
        onended: null,
        connect: () => undefined,
        start(when: number) {
          this.startedAt = when;
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(s);
      return s;
    },
  };
  return { ctx, sources };
}

// 2400 samples at 24 kHz = exactly 100 ms
const chunk = arrayBufferToBase64(float32ToPcm16(new Float32Array(2400).fill(0.2)).buffer as ArrayBuffer);

describe("AudioPlayer", () => {
  let fake: ReturnType<typeof makeContext>;
  let player: AudioPlayer;
  const onPlayingChange = vi.fn();

  beforeEach(() => {
    fake = makeContext();
    onPlayingChange.mockClear();
    player = new AudioPlayer({ onPlayingChange }, () => fake.ctx as unknown as AudioContext);
    player.prepare();
  });

  it("schedules chunks back-to-back on the audio clock (gapless)", async () => {
    await player.enqueue(chunk);
    await player.enqueue(chunk);
    await player.enqueue(chunk);
    const [a, b, c] = fake.sources;
    expect(a?.startedAt).toBeCloseTo(10.03, 5); // now + small lead
    expect(b?.startedAt).toBeCloseTo((a?.startedAt as number) + 0.1, 5);
    expect(c?.startedAt).toBeCloseTo((b?.startedAt as number) + 0.1, 5);
  });

  it("restarts from 'now' after a pause so late chunks are never scheduled in the past", async () => {
    await player.enqueue(chunk);
    fake.ctx.currentTime = 50; // a long gap in the stream
    await player.enqueue(chunk);
    expect(fake.sources[1]?.startedAt).toBeCloseTo(50.03, 5);
  });

  it("reports playing state and stops everything on interrupt", async () => {
    await player.enqueue(chunk);
    await player.enqueue(chunk);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    player.interrupt();
    expect(fake.sources.every((s) => s.stopped)).toBe(true);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    expect(player.isPlaying).toBe(false);
  });

  it("goes idle only when the last queued chunk has ended", async () => {
    await player.enqueue(chunk);
    await player.enqueue(chunk);
    fake.sources[0]?.onended?.();
    expect(player.isPlaying).toBe(true);
    fake.sources[1]?.onended?.();
    expect(player.isPlaying).toBe(false);
  });

  it("close() releases the AudioContext", async () => {
    await player.close();
    expect(fake.ctx.close).toHaveBeenCalledTimes(1);
  });

  it("ignores empty chunks", async () => {
    await player.enqueue("");
    expect(fake.sources).toHaveLength(0);
  });
});
