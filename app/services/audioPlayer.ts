import { LIVE_OUTPUT_SAMPLE_RATE } from "../config/live";
import { base64PcmToFloat32, levelOf } from "../utils/audioUtils";

export interface PlayerCallbacks {
  onPlayingChange?: (playing: boolean) => void;
  onLevel?: (level: number) => void;
}

/** Start playback slightly ahead of "now" so the first chunk is never scheduled in the past. */
const SCHEDULE_AHEAD_S = 0.03;

/**
 * Gapless playback of streamed PCM chunks.
 *
 * Every chunk is scheduled at an exact time on the audio clock (`nextStartTime`), so chunks play
 * back-to-back with no clicks. Chaining chunks through `onended` would add a main-thread hop
 * (and a possible gap) between every pair.
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private playing = false;

  constructor(
    private readonly callbacks: PlayerCallbacks = {},
    private readonly createContext: () => AudioContext = () => new AudioContext({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE }),
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Create the AudioContext. Call from a user gesture (button click) so the browser allows audio. */
  prepare(): void {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = this.createContext();
      this.nextStartTime = 0;
    }
    void this.ctx.resume();
  }

  async enqueue(base64Pcm: string): Promise<void> {
    if (!this.ctx) this.prepare();
    const ctx = this.ctx as AudioContext;
    if (ctx.state === "suspended") await ctx.resume();

    const samples = base64PcmToFloat32(base64Pcm);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, LIVE_OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + SCHEDULE_AHEAD_S, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.setPlaying(false);
    };

    this.setPlaying(true);
    this.callbacks.onLevel?.(levelOf(samples));
  }

  /** Stop everything that is queued or playing (the user barged in, or the session ended). */
  interrupt(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
    this.setPlaying(false);
  }

  async close(): Promise<void> {
    this.interrupt();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") await ctx.close();
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.callbacks.onPlayingChange?.(playing);
  }
}
