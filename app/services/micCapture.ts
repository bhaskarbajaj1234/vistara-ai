import { LIVE_INPUT_SAMPLE_RATE, MIC_FRAME_SAMPLES } from "../config/live";
import { arrayBufferToBase64 } from "../utils/audioUtils";

export interface MicCaptureOptions {
  onChunk: (base64Pcm: string, level: number) => void;
  frameSize?: number;
}

/**
 * Captures the microphone through an AudioWorklet (audio thread) and hands base64 PCM frames to `onChunk`.
 * The AudioContext runs at 16 kHz, so the browser resamples the mic for us.
 */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private muted = false;

  constructor(private readonly options: MicCaptureOptions) {}

  /** Create the AudioContext. Call from a user gesture (button click). */
  prepare(): void {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ sampleRate: LIVE_INPUT_SAMPLE_RATE });
    }
    void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  async start(stream: MediaStream): Promise<void> {
    if (!this.ctx) this.prepare();
    const ctx = this.ctx as AudioContext;
    await ctx.audioWorklet.addModule("/worklets/audio-processor.js");

    const node = new AudioWorkletNode(ctx, "audio-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { frameSize: this.options.frameSize ?? MIC_FRAME_SAMPLES },
    });
    node.port.onmessage = (event: MessageEvent<{ pcmData: ArrayBuffer; level: number }>) => {
      const { pcmData, level } = event.data;
      this.options.onChunk(arrayBufferToBase64(pcmData), this.muted ? 0 : level);
    };

    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(node); // deliberately NOT connected to the speakers: that would echo the mic
    this.node = node;
  }

  async stop(): Promise<void> {
    this.source?.disconnect();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.source = null;
    this.node = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") await ctx.close();
  }
}
