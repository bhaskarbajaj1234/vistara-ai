import { Base64 } from "js-base64";

/** Float32 samples in [-1, 1] -> signed 16-bit PCM, clamped so loud input saturates instead of wrapping. */
export function float32ToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Signed 16-bit PCM -> Float32 samples in [-1, 1). */
export function pcm16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = (input[i] ?? 0) / 32768;
  return out;
}

/** Base64 string of little-endian 16-bit PCM bytes -> Float32 samples. */
export function base64PcmToFloat32(b64: string): Float32Array {
  const bytes = Base64.toUint8Array(b64);
  const evenLength = bytes.length - (bytes.length % 2);
  // slice() copies into a fresh, aligned buffer, which Int16Array requires.
  const aligned = bytes.slice(0, evenLength);
  return pcm16ToFloat32(new Int16Array(aligned.buffer, 0, evenLength / 2));
}

/** PCM bytes of any ArrayBuffer -> base64 (used for mic frames posted by the AudioWorklet). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Base64.fromUint8Array(new Uint8Array(buffer));
}

/** Rough loudness 0-100 from float samples (mean absolute value, scaled for speech). */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += Math.abs(samples[i] ?? 0);
  return Math.min((sum / samples.length) * 500, 100);
}
