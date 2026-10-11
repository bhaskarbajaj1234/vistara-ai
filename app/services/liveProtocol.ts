/**
 * Pure helpers for the Gemini Live API WebSocket protocol:
 *   client -> server: setup, realtimeInput (audio | video | text)
 *   server -> client: setupComplete, serverContent (modelTurn audio, input/output transcription,
 *                     interrupted, turnComplete), goAway, sessionResumptionUpdate
 * Keeping them free of side effects makes the protocol unit-testable without a socket.
 */

export const LIVE_HOST = "generativelanguage.googleapis.com";

/** Ephemeral tokens (names start with "auth_tokens/") use the v1alpha "Constrained" endpoint and `access_token`. */
export function buildLiveUrl(token: string): string {
  return `wss://${LIVE_HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
}

export type ServerEvent =
  | { type: "setupComplete" }
  | { type: "inputTranscript"; text: string }
  | { type: "outputTranscript"; text: string }
  | { type: "audio"; data: string }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "goAway"; timeLeft?: string }
  | { type: "resumptionUpdate"; handle?: string; resumable: boolean };

interface RawServerMessage {
  setupComplete?: unknown;
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  serverContent?: {
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
}

/** Turn one raw JSON message from the server into zero or more typed events (in a stable order). */
export function parseServerMessage(raw: string): ServerEvent[] {
  let msg: RawServerMessage;
  try {
    msg = JSON.parse(raw) as RawServerMessage;
  } catch {
    return [];
  }

  const events: ServerEvent[] = [];
  if (msg.setupComplete !== undefined) events.push({ type: "setupComplete" });

  if (msg.sessionResumptionUpdate) {
    events.push({
      type: "resumptionUpdate",
      handle: msg.sessionResumptionUpdate.newHandle,
      resumable: msg.sessionResumptionUpdate.resumable === true,
    });
  }
  if (msg.goAway) events.push({ type: "goAway", timeLeft: msg.goAway.timeLeft });

  const content = msg.serverContent;
  if (content) {
    if (content.inputTranscription?.text) {
      events.push({ type: "inputTranscript", text: content.inputTranscription.text });
    }
    for (const part of content.modelTurn?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data && inline.mimeType?.startsWith("audio/pcm")) {
        events.push({ type: "audio", data: inline.data });
      }
    }
    if (content.outputTranscription?.text) {
      events.push({ type: "outputTranscript", text: content.outputTranscription.text });
    }
    if (content.interrupted === true) events.push({ type: "interrupted" });
    if (content.turnComplete === true) events.push({ type: "turnComplete" });
  }
  return events;
}

export function buildSetupMessage(opts: { model: string; resumeHandle?: string | null }) {
  const model = opts.model.startsWith("models/") ? opts.model : `models/${opts.model}`;
  return {
    setup: {
      model,
      generationConfig: { responseModalities: ["AUDIO"] },
      // Native transcription of BOTH sides, streamed over the same socket as the audio.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Lets a dropped connection continue the same conversation, and keeps long sessions alive.
      sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

export const buildAudioMessage = (b64: string) => ({
  realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: b64 } },
});

export const buildVideoMessage = (b64: string) => ({
  realtimeInput: { video: { mimeType: "image/jpeg", data: b64 } },
});

export const buildTextMessage = (text: string) => ({ realtimeInput: { text } });

/** Reconnect delay: exponential backoff (1s, 2s, 4s ...) capped, with optional jitter for tests/determinism. */
export function nextBackoffMs(attempt: number, baseMs: number, maxMs: number, jitter: () => number = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.75 + jitter() * 0.5));
}
