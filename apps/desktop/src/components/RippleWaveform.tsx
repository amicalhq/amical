import { useEffect, useRef, type RefObject } from "react";

// Loudness starts at the center bar; each ring out is older and lower.
const RING_DELAY_MS = 50;
const RING_GAIN = [1, 0.84, 0.64, 0.44];
const CENTER = RING_GAIN.length - 1;
const BAR_COUNT = 2 * RING_GAIN.length - 1;
const HISTORY_MS = RING_DELAY_MS * CENTER + 50;
const SPRING_STIFFNESS = 420;
const SPRING_DAMPING = 2 * 0.58 * Math.sqrt(SPRING_STIFFNESS);
const SPRING_STEP_S = 1 / 240;
// While quiet, bars breathe about half a pixel so a live mic is visible.
const BREATHE_AMPLITUDE = 0.07;
const BREATHE_HZ = 0.55;
const MAX_OVERSHOOT = 1.08;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface RippleWaveformProps {
  /** Latest voice level (0..1), read once per animation frame. */
  levelRef: RefObject<number>;
  isRecording: boolean;
}

/**
 * Seven bars that rest as dots. While recording, loudness rises at the center
 * bar and ripples out to both sides on springs. Frames write the `--v` CSS
 * variable directly, so the animation never re-renders React.
 */
export function RippleWaveform({ levelRef, isRecording }: RippleWaveformProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!isRecording || !root) return;
    const bars = Array.from(root.children as HTMLCollectionOf<HTMLElement>);
    // Mirrored bars move together, so each ring needs one spring.
    const rings = RING_GAIN.map(() => ({ x: 0, v: 0 }));
    const history: Array<[timeMs: number, level: number]> = [];
    let slowLevel = 0;
    let lastMs = performance.now();
    let frame = 0;

    const levelAt = (timeMs: number) => {
      for (let i = history.length - 1; i >= 0; i--) {
        const [t, level] = history[i];
        if (t > timeMs) continue;
        const next = history[i + 1];
        if (!next) return level;
        return level + ((next[1] - level) * (timeMs - t)) / (next[0] - t);
      }
      return 0;
    };

    const tick = (nowMs: number) => {
      // The first frame can start before the effect ran.
      const dt = Math.min(0.1, Math.max(0, nowMs - lastMs) / 1000);
      lastMs = nowMs;
      const level = levelRef.current;
      history.push([nowMs, level]);
      while (history.length > 2 && history[1][0] < nowMs - HISTORY_MS) {
        history.shift();
      }
      const follow = level > slowLevel ? 0.05 : 0.35;
      slowLevel += (level - slowLevel) * (1 - Math.exp(-dt / follow));
      const idle = 1 - smoothstep(0.03, 0.2, slowLevel);

      rings.forEach((spring, ring) => {
        const breathe =
          0.5 +
          0.5 *
            Math.sin(2 * Math.PI * BREATHE_HZ * (nowMs / 1000) - ring * 0.8);
        const target =
          levelAt(nowMs - ring * RING_DELAY_MS) * RING_GAIN[ring] +
          idle * BREATHE_AMPLITUDE * breathe;
        for (let rem = dt; rem > 0; rem -= SPRING_STEP_S) {
          const h = Math.min(rem, SPRING_STEP_S);
          spring.v +=
            (SPRING_STIFFNESS * (target - spring.x) -
              SPRING_DAMPING * spring.v) *
            h;
          spring.x += spring.v * h;
        }
      });
      bars.forEach((bar, i) => {
        const x = rings[Math.abs(i - CENTER)].x;
        const v = Math.min(MAX_OVERSHOOT, Math.max(0, x));
        bar.style.setProperty("--v", v.toFixed(3));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      bars.forEach((bar) => bar.style.removeProperty("--v"));
    };
  }, [isRecording, levelRef]);

  return (
    <div ref={rootRef} className="flex h-full items-center gap-[3.5px]">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-white"
          style={{
            height: "calc(3px + (75% - 3px) * var(--v, 0))",
            opacity: "calc(0.72 + 0.28 * min(var(--v, 0), 1))",
          }}
        />
      ))}
    </div>
  );
}
