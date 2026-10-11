"use client";

import { CameraPreview } from "./components/CameraPreview";
import { ChatPanel } from "./components/ChatPanel";
import { StatsPanel } from "./components/StatsPanel";
import { useLiveSession } from "./hooks/useLiveSession";

export default function Home() {
  const live = useLiveSession();

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Vistara AI</h1>
        <p className="text-sm text-muted-foreground">Talk, show and type to Gemini in real time.</p>
      </header>

      <div className="flex flex-col items-stretch gap-6 lg:flex-row">
        <div className="flex w-full flex-col gap-4 lg:w-1/2">
          <CameraPreview
            videoRef={live.videoRef}
            status={live.status}
            error={live.error}
            modelSpeaking={live.modelSpeaking}
            muted={live.muted}
            onStart={live.start}
            onStop={live.stop}
            onToggleMute={live.toggleMute}
            getMicLevel={live.getMicLevel}
            getOutputLevel={live.getOutputLevel}
          />
          <StatsPanel stats={live.stats} />
        </div>
        <div className="flex w-full lg:w-1/2">
          <ChatPanel messages={live.messages} canSend={live.status === "live"} onSend={live.sendText} />
        </div>
      </div>
    </div>
  );
}
