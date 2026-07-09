import { useTranslation } from "react-i18next";
import { KeycapSentence, KEYS_SENTINEL } from "./KeyCap";
import { cn } from "@/lib/utils";

/**
 * The coach bubble: floats bottom-center above the sheet's footer, clear of
 * where the dictated text lands (it grows from the top of the sheet).
 * Instruction-only (users dictate in their own language) with the REAL
 * configured shortcut as keycap chips. Passive — dictation is driven by
 * physically holding the shortcut — and lights indigo while recording. Stays
 * dark in both themes, like the sheet it sits on.
 */
export function CoachBubble({
  ctaKey,
  recording,
  shortcut,
}: {
  ctaKey: string;
  recording: boolean;
  shortcut: number[];
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "absolute bottom-[76px] left-1/2 z-10 -translate-x-1/2 select-none rounded-2xl px-4 py-3 shadow-xl transition-colors duration-150",
        recording ? "bg-brand shadow-brand/40" : "bg-zinc-900 shadow-black/30",
      )}
    >
      <KeycapSentence
        className="whitespace-nowrap text-[13.5px] font-bold text-white"
        sentence={t(ctaKey, { keys: KEYS_SENTINEL })}
        codes={shortcut}
        kbdClassName="rounded-[5px] border border-white/20 bg-white/15 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold"
      />
    </div>
  );
}
