import React from "react";

interface WaveformProps {
  isRecording: boolean;
  /** This bar's spectrum energy (0..1). */
  level: number;
  baseHeight?: number;
  silentHeight?: number;
}

export function Waveform({
  isRecording,
  level,
  baseHeight = 20,
  silentHeight = 20,
}: WaveformProps) {
  const minHeight = silentHeight;
  const maxHeight = baseHeight;

  if (!isRecording) {
    return <div className="h-[15%] w-1 rounded-full bg-white" />;
  }

  const clampedLevel = Math.min(1, Math.max(0, level));
  const height = minHeight + (maxHeight - minHeight) * clampedLevel;

  // Drive the height directly and let a short CSS transition bridge the ~32ms
  // gaps between frames. A framer-motion tween restarts on every render (faster
  // than its own duration), which smears the signal and looks janky.
  return (
    <div
      className="w-1 rounded-full bg-white"
      style={{ height: `${height}%`, transition: "height 70ms linear" }}
    />
  );
}
