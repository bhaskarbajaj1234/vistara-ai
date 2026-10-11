// Runs on the audio rendering thread, so the main thread (React) never blocks audio capture.
// Collects mic samples into fixed-size frames, converts float32 -> 16-bit PCM and posts each frame.
class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const size = options && options.processorOptions && options.processorOptions.frameSize;
    this.frameSize = Number.isInteger(size) && size >= 128 ? size : 1024;
    this.pcm = new Int16Array(this.frameSize);
    this.count = 0;
    this.absSum = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // Clamp to [-1, 1] so loud input saturates instead of wrapping around in Int16.
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.pcm[this.count++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.absSum += Math.abs(s);
      if (this.count === this.frameSize) this.flush();
    }
    return true;
  }

  flush() {
    const level = Math.min((this.absSum / this.frameSize) * 500, 100);
    const buffer = this.pcm.buffer;
    // Transfer (not copy) the buffer to the main thread.
    this.port.postMessage({ pcmData: buffer, level }, [buffer]);
    this.pcm = new Int16Array(this.frameSize);
    this.count = 0;
    this.absSum = 0;
  }
}

registerProcessor("audio-processor", AudioProcessor);
