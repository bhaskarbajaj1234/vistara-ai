import { describe, expect, it } from "vitest";
import { Base64 } from "js-base64";
import { arrayBufferToBase64, base64PcmToFloat32, float32ToPcm16, levelOf, pcm16ToFloat32 } from "../app/utils/audioUtils";

describe("audioUtils", () => {
  it("clamps loud samples instead of wrapping around", () => {
    const pcm = float32ToPcm16(new Float32Array([2, -2, 0.5, -0.5, 0]));
    expect(pcm[0]).toBe(32767);
    expect(pcm[1]).toBe(-32768);
    expect(pcm[2]).toBe(16383);
    expect(pcm[3]).toBe(-16384);
    expect(pcm[4]).toBe(0);
  });

  it("round-trips PCM through base64 with negligible error", () => {
    const original = new Float32Array([0, 0.25, -0.25, 0.9, -0.9]);
    const pcm = float32ToPcm16(original);
    const b64 = arrayBufferToBase64(pcm.buffer as ArrayBuffer);
    const decoded = base64PcmToFloat32(b64);
    expect(decoded).toHaveLength(original.length);
    original.forEach((v, i) => expect(decoded[i]).toBeCloseTo(v, 3));
  });

  it("ignores a dangling odd byte instead of throwing", () => {
    const bytes = new Uint8Array([1, 0, 2, 0, 9]); // two samples + one stray byte
    expect(base64PcmToFloat32(Base64.fromUint8Array(bytes))).toHaveLength(2);
  });

  it("pcm16ToFloat32 maps full scale to [-1, 1)", () => {
    const out = pcm16ToFloat32(new Int16Array([-32768, 0, 32767]));
    expect(out[0]).toBe(-1);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(1, 4);
  });

  it("levelOf is 0 for silence and capped at 100", () => {
    expect(levelOf(new Float32Array(100))).toBe(0);
    expect(levelOf(new Float32Array(100).fill(1))).toBe(100);
    expect(levelOf(new Float32Array(0))).toBe(0);
  });
});
