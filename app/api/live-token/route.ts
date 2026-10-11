import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/app/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live";
const TOKEN_LIFETIME_MS = 30 * 60 * 1000; // how long the session may stay open
const NEW_SESSION_WINDOW_MS = 2 * 60 * 1000; // how long the browser has to START a session with this token
const limiter = createRateLimiter(10, 60_000);

const json = (body: object, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** Browsers send an Origin header on POST. Reject other websites; allow same-origin and ALLOWED_ORIGINS. */
function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser client (curl, server-side); the rate limit still applies
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return origin === request.nextUrl.origin || allowed.includes(origin);
}

/**
 * POST /api/live-token
 * Mints a short-lived, single-use Gemini "ephemeral token". The real API key stays on the server;
 * the browser only ever receives a token that expires in minutes.
 */
export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return json({ error: "FORBIDDEN_ORIGIN", message: "This origin is not allowed." }, 403);
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, retryAfterSeconds } = limiter(ip);
  if (!allowed) {
    return json({ error: "RATE_LIMITED", message: "Too many session requests. Try again shortly." }, 429, {
      "Retry-After": String(retryAfterSeconds),
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[live-token] GEMINI_API_KEY is not set");
    return json({ error: "SERVER_MISCONFIGURED", message: "The server is missing GEMINI_API_KEY." }, 500);
  }

  try {
    // Ephemeral tokens are only available on the v1alpha API version.
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
      },
    });
    if (!token.name) throw new Error("Token response had no name");
    return json({ token: token.name, model: MODEL });
  } catch (error) {
    console.error("[live-token] failed to create token:", error);
    return json({ error: "TOKEN_FAILED", message: "Could not create a session token." }, 502);
  }
}
