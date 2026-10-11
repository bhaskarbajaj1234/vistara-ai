/** Fixed-window, in-memory rate limiter (per key, e.g. client IP). Fine for one instance; use a shared store for several. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const t = now();
    // Opportunistic cleanup keeps the map from growing without bound.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      hits.set(key, { count: 1, resetAt: t + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    return { allowed: entry.count <= limit, retryAfterSeconds: Math.ceil((entry.resetAt - t) / 1000) };
  };
}
