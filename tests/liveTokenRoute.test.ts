import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
const ctorArgs = vi.hoisted(() => ({ last: undefined as unknown }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    authTokens = { create };
    constructor(options: unknown) {
      ctorArgs.last = options;
    }
  },
}));

import { POST } from "../app/api/live-token/route";

let ipCounter = 0;
const request = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/live-token", {
    method: "POST",
    headers: { "x-forwarded-for": `10.0.0.${++ipCounter}`, ...headers },
  });

describe("POST /api/live-token", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ name: "auth_tokens/abc123" });
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("returns a short-lived token and the model, never the API key", async () => {
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ token: "auth_tokens/abc123", model: "gemini-3.8-live" });
    expect(JSON.stringify(body)).not.toContain("test-key");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("creates a single-use token with expiry times, on the v1alpha API", async () => {
    await POST(request());
    expect(ctorArgs.last).toMatchObject({ apiKey: "test-key", httpOptions: { apiVersion: "v1alpha" } });
    const { config } = create.mock.calls[0]?.[0] as { config: { uses: number; expireTime: string; newSessionExpireTime: string } };
    expect(config.uses).toBe(1);
    const lifetime = Date.parse(config.expireTime) - Date.now();
    const window = Date.parse(config.newSessionExpireTime) - Date.now();
    expect(lifetime).toBeGreaterThan(25 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(30 * 60_000);
    expect(window).toBeLessThanOrEqual(2 * 60_000);
  });

  it("rejects requests from other origins but allows same-origin", async () => {
    expect((await POST(request({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(request({ origin: "http://localhost:3000" }))).status).toBe(200);
  });

  it("rate limits repeated requests from one IP", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await POST(request(headers))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("fails clearly when the server key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("SERVER_MISCONFIGURED");
  });

  it("returns 502 without leaking details when Google rejects the request", async () => {
    create.mockRejectedValue(new Error("secret internal detail"));
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret internal detail");
  });
});
