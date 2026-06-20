interface DraftReviewProps {
  text: string;
  onInsert: () => void;
  onDismiss: () => void;
}

// Minimal read-only review box for draft results. Visual design is
// intentionally rough for now (looks are refined separately); this exists to
// carry the end-to-end flow: show the generated text, then Insert or Dismiss.
export function DraftReview({ text, onInsert, onDismiss }: DraftReviewProps) {
  return (
    <div
      className="mb-2 flex max-h-[280px] w-[560px] select-text flex-col gap-3 rounded-[20px] bg-black/70 p-4 shadow-lg ring-1 ring-black/60 backdrop-blur-md"
      style={{ pointerEvents: "auto" }}
    >
      <div className="min-h-0 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-white/90">
        {text}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
        <button
          onClick={onInsert}
          className="flex h-8 items-center rounded-full bg-white/15 px-3 text-sm font-medium text-white transition-colors hover:bg-white/25"
        >
          Insert
        </button>
      </div>
    </div>
  );
}
