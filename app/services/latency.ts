import { SPEECH_LEVEL_THRESHOLD } from "../config/live";

export interface Summary {
  count: number;
  p50: number | null;
  p95: number | null;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

const summarize = (values: number[]): Summary => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
});

export interface LatencySummary {
  /** Typed message sent -> first model audio chunk received. Exact and repeatable. */
  text: Summary;
  /** Last loud mic frame -> first model audio chunk. Approximate: includes the server's end-of-speech detection. */
  voice: Summary;
}

/**
 * Measures "time to first audio" for each user input.
 *   - text:  the moment a typed message is sent
 *   - voice: the last mic frame above the speech threshold (updated while the user keeps talking)
 * The next model audio chunk closes the measurement.
 */
export class LatencyTracker {
  private pending: { kind: "text" | "voice"; startedAt: number } | null = null;
  private modelSpeaking = false;
  private readonly samples = { text: [] as number[], voice: [] as number[] };

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly threshold: number = SPEECH_LEVEL_THRESHOLD,
  ) {}

  textSent(): void {
    this.pending = { kind: "text", startedAt: this.now() };
  }

  micLevel(level: number): void {
    // While the model talks, mic energy is mostly echo/barge-in, so it would distort the measurement.
    if (this.modelSpeaking || level < this.threshold || this.pending?.kind === "text") return;
    this.pending = { kind: "voice", startedAt: this.now() };
  }

  setModelSpeaking(speaking: boolean): void {
    this.modelSpeaking = speaking;
  }

  modelAudio(): void {
    if (!this.pending) return;
    this.samples[this.pending.kind].push(this.now() - this.pending.startedAt);
    this.pending = null;
  }

  reset(): void {
    this.pending = null;
    this.modelSpeaking = false;
    this.samples.text = [];
    this.samples.voice = [];
  }

  summary(): LatencySummary {
    return { text: summarize(this.samples.text), voice: summarize(this.samples.voice) };
  }
}
