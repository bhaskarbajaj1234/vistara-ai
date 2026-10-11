# What changed (old file -> new file)

| Old | New | Why |
|---|---|---|
| `NEXT_PUBLIC_GEMINI_API_KEY` in the browser | `GEMINI_API_KEY` on the server + `app/api/live-token/route.ts` | Key was exposed to every visitor |
| `app/services/geminiWebSocket.ts` (key in URL, logs every message, unordered async frames) | Same file, rewritten: ephemeral-token URL, ordered inbox, setup gating, close info; protocol helpers moved to `liveProtocol.ts` | Security, ordering, testability |
| `app/services/transcriptionService.ts` (REST call per turn) | **Deleted**. Native transcription only (`transcript.ts`) | Duplicate, non-live, deprecated SDK |
| `app/components/CameraPreview.tsx` (521-line component) | Split: `CameraPreview.tsx` (view), `hooks/useLiveSession.ts`, `services/liveSession.ts`, `micCapture.ts`, `videoFrames.ts`, `audioPlayer.ts` | Modularity |
| Mic muted while the model speaks | Always open; `interrupted` flushes playback | Full duplex / barge-in |
| `onended` chaining of audio chunks | Scheduled playback (`audioPlayer.ts`) | Gapless audio |
| No text input | Chat input -> `realtimeInput.text` | "Text feed" |
| `app/page.tsx` fixed `w-[640px]` layout, all messages labelled Gemini | Responsive layout; `ChatPanel` with user/model bubbles, auto-scroll | Responsive + correct speakers |
| - | `app/services/latency.ts` + `StatsPanel.tsx` | Measured latency |
| - | Reconnect with backoff + session resumption | Resilience |
| `public/worklets/audio-processor.js` (hardcoded 2048, no clamp) | Configurable frame size, clamped PCM | Latency tuning, correctness |
| `@google/generative-ai`, `lamejs` | `@google/genai` (only for token minting) | Deprecated / unused |
| `next.config.js` + `next.config.ts`, wildcard CORS header | One minimal config | Cleanup |
| Titles "Vistara A", "Camera Preview App", missing avatar, README mismatches | Fixed | Polish |
