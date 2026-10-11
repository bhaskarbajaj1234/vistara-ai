import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../app/lib/rateLimit";

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks until the window resets", () => {
    let t = 0;
    const check = createRateLimiter(3, 1000, () => t);
    expect([1, 2, 3].map(() => check("ip").allowed)).toEqual([true, true, true]);
    const blocked = check("ip");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);
    t = 1000;
    expect(check("ip").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const check = createRateLimiter(1, 1000, () => 0);
    expect(check("a").allowed).toBe(true);
    expect(check("b").allowed).toBe(true);
    expect(check("a").allowed).toBe(false);
  });
});
