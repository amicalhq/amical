/**
 * Segmented per-phase progress rail (replaces the numeric step bar).
 * Completed phases fill 100%, the active phase fills proportionally to the
 * user's position within it, upcoming phases are empty. No numeric count — the
 * branch difference (5 phases cloud / 4 local) reads as a phase appearing or
 * not, never as "9 vs 11 steps".
 */
export function PhaseProgress({
  phases,
  currentPhase,
  fill,
}: {
  phases: string[];
  currentPhase: string;
  /** Fraction (0..1) the active phase is filled. */
  fill: number;
}) {
  const currentIndex = phases.indexOf(currentPhase);
  return (
    <div className="shrink-0 px-14 pt-[22px]">
      <div className="flex gap-2">
        {phases.map((phase, i) => {
          const width =
            i < currentIndex
              ? 100
              : i === currentIndex
                ? Math.round(Math.max(0, Math.min(1, fill)) * 100)
                : 0;
          return (
            <div
              className="h-[5px] flex-1 overflow-hidden rounded-full bg-muted"
              key={phase}
            >
              <div
                className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-[width] duration-[550ms] ease-out"
                style={{ width: `${width}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
