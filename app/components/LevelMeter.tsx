"use client";

import { memo, useEffect, useRef } from "react";

interface Props {
  getLevel: () => number;
  active: boolean;
  barClassName?: string;
}

/**
 * Audio level bar. It reads the level straight from the session on every animation frame and writes
 * the width to the DOM directly, so a changing level never triggers a React re-render.
 */
export const LevelMeter = memo(function LevelMeter({ getLevel, active, barClassName = "bg-green-500" }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!active) {
      bar.style.width = "0%";
      return;
    }
    let frame = 0;
    let shown = 0;
    const tick = () => {
      shown = Math.max(getLevel(), shown * 0.9); // fast attack, slow decay
      bar.style.width = `${Math.min(100, shown)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevel, active]);

  return (
    <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div ref={barRef} className={`h-full w-0 rounded-full transition-none ${barClassName}`} />
    </div>
  );
});
