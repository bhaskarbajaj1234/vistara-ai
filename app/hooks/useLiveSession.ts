"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveSession, type LiveStats, type SessionStatus } from "../services/liveSession";
import type { ChatMessage } from "../services/transcript";

const EMPTY_STATS: LiveStats = {
  latency: { text: { count: 0, p50: null, p95: null }, voice: { count: 0, p50: null, p95: null } },
  audioKBps: 0,
  videoKBps: 0,
  uptimeSeconds: 0,
  reconnects: 0,
};

/** React adapter for LiveSession: subscribes to it and exposes plain state plus a few actions. */
export function useLiveSession() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modelSpeaking, setModelSpeaking] = useState(false);
  const [stats, setStats] = useState<LiveStats>(EMPTY_STATS);
  const [muted, setMuted] = useState(false);

  const session = useMemo(
    () =>
      new LiveSession({
        onStatus: (next, message) => {
          setStatus(next);
          setError(message);
        },
        onMessages: setMessages,
        onModelSpeaking: setModelSpeaking,
        onStats: setStats,
      }),
    [],
  );

  // Stop the session (camera, mic, socket) if the component unmounts.
  useEffect(() => () => void session.stop(), [session]);

  const start = useCallback(() => {
    if (videoRef.current) void session.start(videoRef.current);
  }, [session]);

  const stop = useCallback(() => void session.stop(), [session]);

  const toggleMute = useCallback(() => {
    const next = !session.isMuted;
    session.setMuted(next);
    setMuted(next);
  }, [session]);

  const sendText = useCallback((text: string) => session.sendText(text), [session]);
  const getMicLevel = useCallback(() => session.micLevel, [session]);
  const getOutputLevel = useCallback(() => session.outputLevel, [session]);

  return { videoRef, status, error, messages, modelSpeaking, stats, muted, start, stop, toggleMute, sendText, getMicLevel, getOutputLevel };
}
