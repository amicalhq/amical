import { cn } from "@/lib/utils";

const BARS = 12;

/**
 * Live input-level meter, the same design as the settings mic picker's
 * MicLevelMeter (a row of ascending bars that light up in proportion to the
 * level), scaled up for the onboarding preview card and lit in indigo.
 * `level` is 0..1 from useMicLevel.
 */
export function MicLevelBar({ level }: { level: number }) {
  return (
    <div
      className="relative flex h-[72px] items-end justify-center gap-[5px]"
      aria-hidden
    >
      {Array.from({ length: BARS }).map((_, i) => {
        const lit = level * BARS > i;
        // Bars ramp up in height from left to right for an equalizer look.
        const height = 30 + (i / (BARS - 1)) * 70;
        return (
          <div
            key={i}
            className={cn(
              "w-[7px] rounded-full transition-colors duration-75",
              lit ? "bg-indigo-500" : "bg-muted-foreground/20",
            )}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
