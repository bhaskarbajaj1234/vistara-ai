import {
  MAX_RECONNECT_ATTEMPTS,
  MIC_FRAME_SAMPLES,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  STATS_INTERVAL_MS,
} from "../config/live";
import { AudioPlayer } from "./audioPlayer";
import { GeminiWebSocket, type CloseInfo } from "./geminiWebSocket";
import { LatencyTracker, type LatencySummary } from "./latency";
import { nextBackoffMs, type ServerEvent } from "./liveProtocol";
import { MicCapture } from "./micCapture";
import { addUserText, appendTranscript, finalizeTurn, type ChatMessage } from "./transcript";
import { startFrameCapture } from "./videoFrames";

export type SessionStatus = "idle" | "starting" | "connecting" | "live" | "reconnecting" | "error";

export interface LiveStats {
  latency: LatencySummary;
  audioKBps: number;
  videoKBps: number;
  uptimeSeconds: number;
  reconnects: number;
}

export interface SessionHandlers {
  onStatus: (status: SessionStatus, error: string | null) => void;
  onMessages: (messages: ChatMessage[]) => void;
  onModelSpeaking: (speaking: boolean) => void;
  onStats: (stats: LiveStats) => void;
}

export interface TokenResponse {
  token: string;
  model: string;
}

export async function fetchLiveToken(): Promise<TokenResponse> {
  const res = await fetch("/api/live-token", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { message?: string };
  if (!res.ok || !body.token || !body.model) {
    throw new Error(body.message ?? `Could not start a session (HTTP ${res.status}).`);
  }
  return { token: body.token, model: body.model };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describeMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Camera and microphone permission was denied.";
    if (error.name === "NotFoundError") return "No camera or microphone was found.";
    if (error.name === "NotReadableError") return "The camera or microphone is already in use by another app.";
  }
  return error instanceof Error ? error.message : "Something went wrong while starting the session.";
}

/**
 * Owns one live conversation: media devices, mic capture, video frames, the WebSocket, audio playback,
 * transcript state, reconnects and metrics. It is plain TypeScript (no React), so the React layer
 * (useLiveSession) is a thin subscriber and this logic stays testable.
 */
export class LiveSession {
  /** Read by the level meters every animation frame; kept out of React state on purpose. */
  micLevel = 0;
  outputLevel = 0;

  private status: SessionStatus = "idle";
  private messages: ChatMessage[] = [];
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private socket: GeminiWebSocket | null = null;
  private stopFrames: (() => void) | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnects = 0;
  private resumeHandle: string | null = null;
  private startedAt = 0;
  private audioBytes = 0;
  private videoBytes = 0;
  private lastStatsAt = 0;
  private lastAudioBytes = 0;
  private lastVideoBytes = 0;

  private readonly tracker = new LatencyTracker();
  private readonly player: AudioPlayer;
  private readonly mic: MicCapture;

  constructor(
    private readonly handlers: SessionHandlers,
    private readonly fetchToken: () => Promise<TokenResponse> = fetchLiveToken,
  ) {
    this.player = new AudioPlayer({
      onPlayingChange: (playing) => {
        this.tracker.setModelSpeaking(playing);
        this.handlers.onModelSpeaking(playing);
      },
      onLevel: (level) => {
        this.outputLevel = level;
      },
    });
    this.mic = new MicCapture({ frameSize: MIC_FRAME_SAMPLES, onChunk: (b64, level) => this.handleMicChunk(b64, level) });
  }

  get isMuted(): boolean {
    return this.mic.isMuted;
  }

  setMuted(muted: boolean): void {
    this.mic.setMuted(muted);
    if (muted) this.micLevel = 0;
  }

  /** Call from a click handler: the AudioContexts must be created inside a user gesture. */
  async start(video: HTMLVideoElement): Promise<void> {
    if (this.status !== "idle" && this.status !== "error") return;

    this.intentionalClose = false;
    this.video = video;
    this.messages = [];
    this.resumeHandle = null;
    this.reconnectAttempt = 0;
    this.reconnects = 0;
    this.audioBytes = this.videoBytes = this.lastAudioBytes = this.lastVideoBytes = 0;
    this.tracker.reset();
    this.handlers.onMessages(this.messages);
    this.setStatus("starting");

    try {
      // Synchronous, before any await, so the browser still sees the user gesture.
      this.player.prepare();
      this.mic.prepare();

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
      });
      video.srcObject = this.stream;
      video.muted = true;
      await video.play().catch(() => undefined);
      await this.mic.start(this.stream);

      this.startedAt = Date.now();
      this.lastStatsAt = performance.now();
      this.statsTimer = setInterval(() => this.emitStats(), STATS_INTERVAL_MS);

      await this.openSocket();
    } catch (error) {
      await this.teardown();
      this.fail(describeMediaError(error));
    }
  }

  async stop(): Promise<void> {
    if (this.status === "idle") return;
    this.intentionalClose = true;
    await this.teardown();
    this.setStatus("idle");
  }

  sendText(text: string): boolean {
    const clean = text.trim();
    if (!clean || !this.socket?.sendText(clean)) return false;
    this.tracker.textSent();
    this.messages = addUserText(this.messages, clean);
    this.handlers.onMessages(this.messages);
    return true;
  }

  // ---- connection -------------------------------------------------------------------------

  private async openSocket(): Promise<void> {
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const { token, model } = await this.fetchToken();
    if (this.intentionalClose) return;

    const socket = new GeminiWebSocket({
      onSetupComplete: () => {
        if (socket !== this.socket) return;
        this.reconnectAttempt = 0;
        this.setStatus("live");
        this.startVideo();
      },
      onEvent: (event) => {
        if (socket === this.socket) this.handleEvent(event);
      },
      onClose: (info) => this.handleClose(socket, info),
    });
    this.socket = socket;
    socket.connect({ token, model, resumeHandle: this.resumeHandle });
  }

  private handleClose(socket: GeminiWebSocket, info: CloseInfo): void {
    if (socket !== this.socket) return; // an old socket we already replaced
    this.stopVideo();
    this.socket = null;
    if (this.intentionalClose) return;

    const reason = info.reason || `connection closed (code ${info.code})`;
    // Closing before setup means the server rejected the session (bad model/token): retrying will not help.
    if (!info.hadSetup && this.reconnectAttempt === 0) {
      void this.teardown().then(() => this.fail(`Could not start the session: ${reason}`));
      return;
    }
    void this.reconnect(reason);
  }

  private async reconnect(reason: string): Promise<void> {
    while (!this.intentionalClose) {
      this.reconnectAttempt += 1;
      if (this.reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
        await this.teardown();
        this.fail(`Connection lost: ${reason}`);
        return;
      }
      this.reconnects += 1;
      this.setStatus("reconnecting");
      await sleep(nextBackoffMs(this.reconnectAttempt, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS));
      if (this.intentionalClose) return;
      try {
        await this.openSocket();
        return;
      } catch (error) {
        reason = error instanceof Error ? error.message : reason;
      }
    }
  }

  // ---- server events ----------------------------------------------------------------------

  private handleEvent(event: ServerEvent): void {
    switch (event.type) {
      case "audio":
        this.tracker.modelAudio();
        void this.player.enqueue(event.data).catch((error) => console.error("[live] playback failed", error));
        break;
      case "inputTranscript":
        this.messages = appendTranscript(this.messages, "user", event.text);
        this.handlers.onMessages(this.messages);
        break;
      case "outputTranscript":
        this.messages = appendTranscript(this.messages, "model", event.text);
        this.handlers.onMessages(this.messages);
        break;
      case "interrupted":
        this.player.interrupt();
        this.messages = finalizeTurn(this.messages, true);
        this.handlers.onMessages(this.messages);
        break;
      case "turnComplete":
        this.messages = finalizeTurn(this.messages);
        this.handlers.onMessages(this.messages);
        break;
      case "resumptionUpdate":
        if (event.resumable && event.handle) this.resumeHandle = event.handle;
        break;
      case "goAway":
        console.warn(`[live] server will close this connection soon (time left: ${event.timeLeft ?? "unknown"})`);
        break;
      case "setupComplete":
        break;
    }
  }

  // ---- media ------------------------------------------------------------------------------

  private handleMicChunk(b64: string, level: number): void {
    this.micLevel = level;
    if (this.mic.isMuted) return;
    this.tracker.micLevel(level);
    if (this.socket?.sendAudio(b64)) this.audioBytes += (b64.length * 3) / 4;
  }

  private startVideo(): void {
    this.stopVideo();
    if (!this.video) return;
    this.stopFrames = startFrameCapture(this.video, (b64) => {
      if (this.socket?.sendVideo(b64)) this.videoBytes += (b64.length * 3) / 4;
    });
  }

  private stopVideo(): void {
    this.stopFrames?.();
    this.stopFrames = null;
  }

  // ---- lifecycle helpers ------------------------------------------------------------------

  private async teardown(): Promise<void> {
    this.stopVideo();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.socket?.close();
    this.socket = null;
    this.player.interrupt();
    await Promise.allSettled([this.mic.stop(), this.player.close()]);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.micLevel = 0;
    this.outputLevel = 0;
    this.handlers.onModelSpeaking(false);
  }

  private fail(message: string): void {
    this.setStatus("error", message);
  }

  private setStatus(status: SessionStatus, error: string | null = null): void {
    this.status = status;
    this.handlers.onStatus(status, error);
  }

  private emitStats(): void {
    const now = performance.now();
    const seconds = Math.max((now - this.lastStatsAt) / 1000, 0.001);
    this.handlers.onStats({
      latency: this.tracker.summary(),
      audioKBps: (this.audioBytes - this.lastAudioBytes) / 1024 / seconds,
      videoKBps: (this.videoBytes - this.lastVideoBytes) / 1024 / seconds,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      reconnects: this.reconnects,
    });
    this.lastStatsAt = now;
    this.lastAudioBytes = this.audioBytes;
    this.lastVideoBytes = this.videoBytes;
  }
}
