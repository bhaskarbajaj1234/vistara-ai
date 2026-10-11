"use client";

import { memo } from "react";
import type { Summary } from "../services/latency";
import type { LiveStats } from "../services/liveSession";

const ms = (value: number | null) => (value === null ? "–" : `${Math.round(value)} ms`);

function LatencyRow({ label, hint, summary }: { label: string; hint: string; summary: Summary }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt title={hint}>{label}</dt>
      <dd className="tabular-nums">
        p50 {ms(summary.p50)} · p95 {ms(summary.p95)} <span className="text-muted-foreground">(n={summary.count})</span>
      </dd>
    </div>
  );
}

export const StatsPanel = memo(function StatsPanel({ stats }: { stats: LiveStats }) {
  const minutes = Math.floor(stats.uptimeSeconds / 60);
  const seconds = String(stats.uptimeSeconds % 60).padStart(2, "0");
  return (
    <section className="rounded-xl border bg-card p-4 text-xs" aria-label="Session statistics">
      <h2 className="mb-2 text-sm font-semibold">Live statistics</h2>
      <dl className="space-y-1">
        <LatencyRow label="Typed message → first audio" hint="Exact: from sending the message to the first audio chunk" summary={stats.latency.text} />
        <LatencyRow label="Voice → first audio (approx.)" hint="From your last loud mic frame to the first audio chunk; includes the server's end-of-speech detection" summary={stats.latency.voice} />
        <div className="flex justify-between"><dt>Audio upload</dt><dd className="tabular-nums">{stats.audioKBps.toFixed(1)} kB/s</dd></div>
        <div className="flex justify-between"><dt>Video upload</dt><dd className="tabular-nums">{stats.videoKBps.toFixed(1)} kB/s</dd></div>
        <div className="flex justify-between"><dt>Session time</dt><dd className="tabular-nums">{minutes}:{seconds}</dd></div>
        <div className="flex justify-between"><dt>Reconnects</dt><dd className="tabular-nums">{stats.reconnects}</dd></div>
      </dl>
    </section>
  );
});
