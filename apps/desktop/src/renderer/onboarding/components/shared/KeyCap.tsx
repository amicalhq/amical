import { getKeyFromKeycode, keycodeToDisplay } from "@/utils/keycode-map";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";

/** Sentinel interpolated into translated sentences where the keycaps go. */
export const KEYS_SENTINEL = "\u0000";

/**
 * A translated sentence with the user's shortcut rendered as inline kbd chips.
 * `sentence` must be produced with the placeholder set to KEYS_SENTINEL (e.g.
 * `t(key, { keys: KEYS_SENTINEL })`) so the chips land wherever the
 * translation puts them.
 */
export function KeycapSentence({
  sentence,
  codes,
  className,
  kbdClassName,
}: {
  sentence: string;
  codes: number[];
  className?: string;
  kbdClassName: string;
}) {
  const [before, after] = sentence.split(KEYS_SENTINEL);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {before?.trim()}
      {codes.map((code) => (
        <kbd key={code} className={kbdClassName}>
          {keycodeToDisplay(code).toLowerCase()}
        </kbd>
      ))}
      {after?.trim()}
    </span>
  );
}

/**
 * A single keyboard keycap. Turns indigo and presses down while `active` —
 * used to show the configured dictation shortcut lighting up while
 * physically held.
 */
export function KeyCap({
  keycode,
  active,
}: {
  keycode: number;
  active: boolean;
}) {
  // The globe glyph mirrors the physical Fn key on Mac keyboards; other keys
  // don't carry a corner glyph.
  const isFn = getKeyFromKeycode(keycode) === "Fn";
  return (
    <div
      className={cn(
        "relative flex size-[78px] select-none flex-col items-start justify-between rounded-2xl border border-b-4 border-border bg-secondary px-3.5 py-3 text-foreground shadow-[0_8px_20px_-12px_rgba(0,0,0,0.4)] transition-all duration-150",
        active &&
          "translate-y-0.5 scale-105 border-indigo-400 bg-indigo-500 text-white ring-4 ring-indigo-500/25",
      )}
    >
      <span
        className={cn(
          "self-end [&_svg]:size-[15px]",
          active ? "text-white/85" : "text-muted-foreground",
        )}
      >
        {isFn && <Globe size={15} />}
      </span>
      <span className="text-base font-semibold leading-none">
        {keycodeToDisplay(keycode).toLowerCase()}
      </span>
    </div>
  );
}
