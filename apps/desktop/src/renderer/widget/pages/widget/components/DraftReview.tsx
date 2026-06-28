import { useState, useEffect, useRef, type ReactNode } from "react";
import { CornerDownLeft, Copy, Check, X, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RecordingStatus } from "@/hooks/useRecording";
import { Waveform } from "@/components/Waveform";

interface DraftReviewProps {
  text: string;
  onInsert: () => void;
  onDismiss: () => void;
  recordingStatus: RecordingStatus;
  voiceDetected: boolean;
}

// A small keyboard-cap hint (e.g. ↵, esc) that teaches the shortcut driving
// each action — Enter inserts, Esc dismisses (both handled in the main process).
// `light` sits on the dark glass; `dark` sits on the light Insert button.
function Kbd({
  children,
  tone = "light",
}: {
  children: ReactNode;
  tone?: "light" | "dark";
}) {
  const toneClass =
    tone === "dark"
      ? "bg-black/[0.12] text-widget-control-foreground/70 ring-black/[0.08]"
      : "bg-white/[0.08] text-white/55 ring-white/10";
  return (
    <kbd
      className={`flex items-center justify-center rounded-[5px] px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none ring-1 ring-inset ${toneClass}`}
    >
      {children}
    </kbd>
  );
}

// Review surface for a generated draft: shows the text, then lets the user
// Insert (also via Enter), Copy, or dismiss (also via Esc / the top-right ✕).
// Styled to sit natively on the always-dark widget glass (see FloatingButton).
export function DraftReview({
  text,
  onInsert,
  onDismiss,
  recordingStatus,
  voiceDetected,
}: DraftReviewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const copyResetRef = useRef<NodeJS.Timeout | null>(null);

  // Sticky draft: the review stays open while a replacement is dictated. During
  // that window the action bar becomes a live status (Insert/Copy return once
  // idle); Enter is disarmed meanwhile (see RecordingManager.syncDraftEnterMask).
  const isRecording =
    recordingStatus.state === "recording" ||
    recordingStatus.state === "starting";
  const isStopping = recordingStatus.state === "stopping";
  const isRedictating = isRecording || isStopping;

  // Gentle entrance (fade + rise) once mounted.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(raf);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy draft", error);
    }
  };

  return (
    <div
      className={`relative mb-2 flex max-h-[296px] w-[560px] select-text flex-col rounded-[20px] bg-black shadow-[0px_0px_15px_0px_rgba(0,0,0,0.40)] ring-[1px] ring-black/60 transition-all duration-200 ease-out before:pointer-events-none before:absolute before:inset-[1px] before:rounded-[19px] before:outline before:outline-white/15 ${
        shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
      style={{ pointerEvents: "auto" }}
    >
      {/* Header: label (left) · dismiss with esc hint (top-right) */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div className="flex items-center gap-1.5 text-white/55">
          <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            {t("widget.draft.label")}
          </span>
        </div>
        <button
          onClick={onDismiss}
          aria-label={t("widget.draft.dismiss")}
          className="group flex items-center gap-1.5 rounded-full py-1 pl-2 pr-1 text-white/45 transition-colors hover:text-white/85"
        >
          <Kbd>esc</Kbd>
          <span className="flex h-6 w-6 items-center justify-center rounded-full transition-colors group-hover:bg-white/10">
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </button>
      </div>

      {/* Body: the generated draft, scrollable + selectable */}
      <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-4 pb-1 text-[13px] leading-relaxed text-white/90">
        {text}
      </div>

      {/* Action bar: a live status while a replacement is being dictated;
          otherwise Copy (ghost) · Insert (primary, Enter). */}
      {isRedictating ? (
        <div className="mt-1 flex shrink-0 items-center gap-2 border-t border-white/[0.08] px-4 pb-3 pt-2.5 text-white/70">
          <PenLine
            className="h-3.5 w-3.5 shrink-0 text-brand"
            strokeWidth={2}
          />
          <span className="text-[12px] font-medium">
            {isStopping
              ? t("widget.draft.drafting")
              : t("widget.draft.listening")}
          </span>
          {isStopping ? (
            <span className="flex items-center gap-[4px]">
              <span className="h-[4px] w-[4px] rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-[4px] w-[4px] rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-[4px] w-[4px] rounded-full bg-blue-500 animate-bounce" />
            </span>
          ) : (
            <span className="flex h-4 items-center gap-[3px]">
              {Array.from({ length: 5 }).map((_, i) => (
                <Waveform
                  key={i}
                  index={i}
                  isRecording
                  voiceDetected={voiceDetected}
                  baseHeight={60}
                  silentHeight={20}
                />
              ))}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1 flex shrink-0 items-center justify-between gap-2 border-t border-white/[0.08] px-3 pb-3 pt-2.5">
          <button
            onClick={handleCopy}
            aria-label={t("widget.draft.copy")}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {copied ? t("widget.draft.copied") : t("widget.draft.copy")}
          </button>
          <button
            onClick={onInsert}
            aria-label={t("widget.draft.insert")}
            className="flex items-center gap-2 rounded-full bg-widget-control py-1.5 pl-3.5 pr-2 text-[13px] font-medium text-widget-control-foreground transition-transform hover:bg-widget-control/90 active:scale-[0.98]"
          >
            {t("widget.draft.insert")}
            <Kbd tone="dark">
              <CornerDownLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Kbd>
          </button>
        </div>
      )}
    </div>
  );
}
