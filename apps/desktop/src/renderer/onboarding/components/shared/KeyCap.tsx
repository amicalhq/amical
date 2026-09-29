import {
  getKeyFromKeycode,
  keycodeToDisplay,
  keycodeToLegend,
  sortKeycodesForDisplay,
} from "@/utils/keycode-map";
import { isWindows } from "@/utils/platform";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";

// Mac keycaps print words in lowercase, but letters and function keys (F5) in
// uppercase. Windows keycaps keep the case of the word.
function keycapCase(label: string): string {
  const keepCase = isWindows() || label.length === 1 || /^F\d+$/.test(label);
  return keepCase ? label : label.toLowerCase();
}

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
      {sortKeycodesForDisplay(codes).map((code) => (
        <kbd key={code} className={kbdClassName}>
          {keycapCase(keycodeToDisplay(code))}
        </kbd>
      ))}
      {after?.trim()}
    </span>
  );
}

/**
 * A single keyboard keycap: the glyph (or the Fn globe) top-right, the word
 * bottom-left, single characters large and centred. Turns indigo and presses down while `active` — used to show the
 * configured dictation shortcut lighting up while physically held.
 */
export function KeyCap({
  keycode,
  active,
}: {
  keycode: number;
  active: boolean;
}) {
  const { glyph, word, right } = keycodeToLegend(keycode);
  // The globe mirrors the physical Fn key on Mac keyboards.
  const corner =
    getKeyFromKeycode(keycode) === "Fn" ? <Globe size={15} /> : glyph;
  const isSingleCharacter = word.length === 1;
  return (
    <div
      className={cn(
        "relative flex h-[78px] min-w-[78px] select-none whitespace-nowrap rounded-2xl border border-b-4 border-border bg-secondary px-3.5 py-3 text-foreground shadow-[0_8px_20px_-12px_rgba(0,0,0,0.4)] transition-all duration-150",
        isSingleCharacter ? "items-center justify-center" : "items-end",
        active &&
          "translate-y-0.5 scale-105 border-brand/70 bg-brand text-brand-foreground ring-4 ring-brand/25",
      )}
    >
      {corner && (
        <span
          className={cn(
            "absolute right-3.5 top-3 text-[15px] font-medium leading-none [&_svg]:size-[15px]",
            active ? "text-brand-foreground/85" : "text-muted-foreground",
          )}
        >
          {corner}
        </span>
      )}
      <span
        className={
          isSingleCharacter
            ? "text-[22px] font-semibold leading-none"
            : "text-[13px] font-medium leading-none [word-spacing:0.2em]"
        }
      >
        {keycapCase(right ? `Right ${word}` : word)}
      </span>
    </div>
  );
}
