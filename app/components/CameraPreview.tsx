"use client";

import { Loader2, Mic, MicOff, Play, Square } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { SessionStatus } from "../services/liveSession";
import { LevelMeter } from "./LevelMeter";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: SessionStatus;
  error: string | null;
  modelSpeaking: boolean;
  muted: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  getMicLevel: () => number;
  getOutputLevel: () => number;
}

const OVERLAY_TEXT: Partial<Record<SessionStatus, string>> = {
  idle: "Press Start to begin a live session",
  starting: "Starting camera and microphone…",
  connecting: "Connecting to Gemini…",
  reconnecting: "Connection lost. Reconnecting…",
};

export function CameraPreview(props: Props) {
  const { videoRef, status, error, modelSpeaking, muted, onStart, onStop, onToggleMute, getMicLevel, getOutputLevel } = props;
  const isActive = status !== "idle" && status !== "error";
  const busy = status === "starting" || status === "connecting" || status === "reconnecting";
  const overlay = status === "error" ? error ?? "Something went wrong." : OVERLAY_TEXT[status];

  return (
    <section className="flex w-full flex-col gap-3" aria-label="Camera and controls">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {status !== "live" && overlay && (
          <div
            role={status === "error" ? "alert" : "status"}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center text-sm text-white"
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
            <p>{overlay}</p>
          </div>
        )}
        {status === "live" && modelSpeaking && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">Gemini is speaking…</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {isActive ? (
          <Button onClick={onStop} variant="destructive" className="gap-2">
            <Square className="h-4 w-4" aria-hidden="true" /> Stop
          </Button>
        ) : (
          <Button onClick={onStart} className="gap-2">
            <Play className="h-4 w-4" aria-hidden="true" /> Start
          </Button>
        )}
        <Button onClick={onToggleMute} variant="outline" disabled={!isActive} className="gap-2" aria-pressed={muted}>
          {muted ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
          {muted ? "Unmute" : "Mute"}
        </Button>
        <p className="ml-auto text-xs text-muted-foreground">Use headphones to avoid echo while talking over the model.</p>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span>You</span>
        <LevelMeter getLevel={getMicLevel} active={status === "live"} />
        <span>Gemini</span>
        <LevelMeter getLevel={getOutputLevel} active={status === "live"} barClassName="bg-blue-500" />
      </div>
    </section>
  );
}
