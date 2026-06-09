import { cn } from "@/lib/utils";
import { useMicLevel } from "@/hooks/useMicLevel";

const BARS = 12;

/**
 * Compact live input-level meter for the selected microphone. Opens a preview
 * stream for `deviceId` while `active` is true and lights a row of bars in
 * proportion to the audio level coming from that device.
 */
export function MicLevelMeter({
  deviceId,
  active,
}: {
  deviceId: string | undefined;
  active: boolean;
}) {
  const level = useMicLevel(deviceId, active);

  return (
    <div className="flex h-5 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: BARS }).map((_, i) => {
        const lit = active && level * BARS > i;
        // Bars ramp up in height from left to right for an equalizer look.
        const height = 30 + (i / (BARS - 1)) * 70;
        return (
          <div
            key={i}
            className={cn(
              "w-[3px] rounded-full transition-colors duration-75",
              lit ? "bg-primary" : "bg-muted-foreground/25",
            )}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
