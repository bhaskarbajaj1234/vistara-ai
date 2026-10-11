# Vistara AI

A real-time multimodal assistant. Talk, show your camera and type to Gemini; it answers in voice while live captions of **both** sides stream into the chat.

Built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, the Web Audio API (AudioWorklet) and the Gemini Live API over a WebSocket.

```
Browser                                                          Server (Next.js route handler)
┌──────────────────────────────────────────────┐   POST /api/live-token   ┌──────────────────────────┐
│ useLiveSession ─ LiveSession (plain TS)       │ ───────────────────────▶ │ checks origin + rate     │
│   MicCapture  (AudioWorklet, 16 kHz PCM)      │ ◀─── ephemeral token ─── │ limit, mints a 1-use     │
│   VideoFrames (1 fps JPEG, ≤640 px)           │                          │ token (API key stays     │
│   AudioPlayer (24 kHz, gapless scheduling)    │                          │ on the server)           │
│   GeminiWebSocket ◀══ WebSocket (token) ══▶ Gemini Live API              └──────────────────────────┘
│   transcript reducer, latency tracker         │
└──────────────────────────────────────────────┘
```

## Run it locally

```bash
npm install
cp .env.example .env.local      # put your key in GEMINI_API_KEY (no NEXT_PUBLIC_ prefix!)
npm run dev                     # http://localhost:3000
```

Allow camera + microphone, press **Start**. Use headphones if you want to talk over the model (the mic stays open while it speaks, so barge-in works, but speakers can echo).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm test` | 63 unit/integration tests (protocol, audio scheduling, reconnect logic, token route, UI smoke) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |

## Deploy (Render web service)

- Build command: `npm install && npm run build`   Start command: `npm start`
- Environment variables: `GEMINI_API_KEY` (required), `GEMINI_LIVE_MODEL` and `ALLOWED_ORIGINS` (optional).
- **Delete `NEXT_PUBLIC_GEMINI_API_KEY`** from the dashboard and rotate the old key: anything prefixed `NEXT_PUBLIC_` is shipped to every visitor's browser.

## How it works

1. **Session token.** The browser calls `POST /api/live-token`. The route handler checks the `Origin`, applies a per-IP rate limit and asks Google for a single-use *ephemeral token* (30 min session, 2 min to start). Only the token reaches the browser.
2. **Protocol.** `GeminiWebSocket` connects to the `BidiGenerateContentConstrained` endpoint with `access_token`, sends `setup` (audio output, input + output transcription, session resumption, sliding-window context compression) and refuses to send media until `setupComplete`.
3. **Upstream media.** An AudioWorklet (audio thread) converts mic samples to 16-bit PCM in 1024-sample frames (64 ms), a timer sends one downscaled JPEG per second, and typed text goes out as `realtimeInput.text`.
4. **Downstream.** Server frames are decoded in strict arrival order. Audio chunks are scheduled on the audio clock (`nextStartTime`) for gapless playback; `interrupted` flushes the queue.
5. **Captions.** Native `inputTranscription` / `outputTranscription` fragments are merged into one growing bubble per speaker turn (`app/services/transcript.ts`). There is no second transcription request.
6. **Resilience.** An unexpected close triggers exponential-backoff reconnects with a fresh token and the saved resumption handle. A rejection before setup completes fails fast with the server's reason.
7. **Metrics.** `LatencyTracker` records time to first model audio for typed messages (exact) and for voice (approximate: last loud mic frame to first audio, includes the server's end-of-speech detection). The stats panel shows p50/p95 plus upload bandwidth.

## Design decisions

| Decision | Reason | Trade-off |
|---|---|---|
| Ephemeral tokens instead of a key in the browser | The key never leaves the server; a stolen token dies in minutes | `/api/live-token` is still public, so it is origin-checked and rate limited; add real auth before sharing widely |
| Open mic during model speech (full duplex) | Enables barge-in | Needs headphones or good echo cancellation |
| 64 ms mic frames | Lower capture latency than 128 ms | ~16 WebSocket messages/s instead of ~8 |
| Schedule audio on `AudioContext.currentTime` | No gaps/clicks between chunks | Slightly more bookkeeping than chaining `onended` |
| Level meters write to the DOM from `requestAnimationFrame` | No React re-render per audio frame | Imperative code in one small component |
| `LiveSession` is plain TypeScript, hook is a thin adapter | Testable without React; hooks stay small | One more layer |
| Single native transcription path | Real-time, no extra API cost, no duplicates | Depends on the Live API's transcription quality |

## Known limits

- Tested with mocks and unit tests; a full run against the real Gemini Live API and real devices must be done on your machine.
- Voice latency is approximate (see above). Typed-message latency is exact.
- Chrome/Edge are the primary targets. Safari and Firefox have different AudioWorklet/WebSocket behaviours and were not tested.
- The rate limiter and token endpoint protections are in-memory (per instance).
