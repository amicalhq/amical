import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Copy,
  CornerDownLeft,
  Mic,
  PenLine,
  RefreshCw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { SplitScreen, PreviewPanel } from "../shared/SplitScreen";
import { NavigationButtons } from "../shared/NavigationButtons";
import { OnboardingScreen } from "@/types/onboarding";
import { cn } from "@/lib/utils";

interface DraftIntroScreenProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * Inert lookalike of the widget's DraftReview card (see DraftReview.tsx) for
 * the intro demo — same always-dark glass, header, esc/✕, Copy + Insert(↵)
 * anatomy, but nothing is clickable. While `drafting` the footer is the live
 * "Drafting…" status, mirroring the real card's re-dictation state.
 */
function DemoDraftCard({
  visible,
  drafting,
  text,
}: {
  visible: boolean;
  drafting: boolean;
  text: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "relative flex select-none flex-col rounded-[20px] bg-black text-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.40)] transition-all duration-200 ease-out before:pointer-events-none before:absolute before:inset-[1px] before:rounded-[19px] before:outline before:outline-white/15",
        visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div className="flex items-center gap-1.5 text-white/55">
          <PenLine className="size-3.5" strokeWidth={2} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            {t("widget.draft.label")}
          </span>
        </div>
        <div className="flex items-center gap-1.5 py-1 pl-2 pr-1 text-white/45">
          <span className="rounded-[5px] bg-white/[0.08] px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none text-white/55 ring-1 ring-inset ring-white/10">
            esc
          </span>
          <X className="size-3.5" strokeWidth={2.5} />
        </div>
      </div>
      {!drafting && (
        <div className="whitespace-pre-wrap px-4 pb-1 text-[12.5px] leading-[1.55] text-white/90">
          {text}
        </div>
      )}
      {drafting ? (
        <div className="mt-1 flex shrink-0 items-center gap-2 border-t border-white/[0.08] px-4 pb-3 pt-2.5 text-white/70">
          <PenLine className="size-3.5 shrink-0 text-brand" strokeWidth={2} />
          <span className="text-[12px] font-medium">
            {t("widget.draft.drafting")}
          </span>
          <span className="flex items-center gap-[4px]">
            <span className="size-[4px] animate-bounce rounded-full bg-blue-500 [animation-delay:-0.3s]" />
            <span className="size-[4px] animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" />
            <span className="size-[4px] animate-bounce rounded-full bg-blue-500" />
          </span>
        </div>
      ) : (
        <div className="mt-1 flex shrink-0 items-center justify-between gap-2 border-t border-white/[0.08] px-3 pb-3 pt-2.5">
          <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-white/65">
            <Copy className="size-3.5" strokeWidth={2} />
            {t("widget.draft.copy")}
          </span>
          <span className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-3.5 pr-2 text-[13px] font-medium text-zinc-900">
            {t("widget.draft.insert")}
            <span className="flex items-center justify-center rounded-[5px] bg-black/[0.12] px-1.5 py-0.5 ring-1 ring-inset ring-black/[0.08]">
              <CornerDownLeft
                className="size-3.5 text-black/60"
                strokeWidth={2.5}
              />
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

type DemoPhase = "idle" | "speaking" | "drafting" | "done";

/**
 * Auto-playing demo: a spoken instruction "types" into the mic chip (glowing
 * while it speaks), then the draft card pops with the live Drafting… status
 * and reveals the generated text. Purely visual — the try-it screens later run
 * the real pipeline.
 */
function IntroDemo() {
  const { t } = useTranslation();
  const instruction = t("onboarding.draft.intro.demoInstruction");
  const [phase, setPhase] = useState<DemoPhase>("idle");
  const [typed, setTyped] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const run = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setTyped(0);
    const later = (fn: () => void, ms: number) =>
      timersRef.current.push(setTimeout(fn, ms));
    later(() => {
      setPhase("speaking");
      const tick = (i: number) => {
        setTyped(Math.min(i, instruction.length));
        if (i >= instruction.length) {
          later(() => setPhase("drafting"), 350);
          later(() => setPhase("done"), 1450);
          return;
        }
        later(() => tick(i + 2), 40);
      };
      tick(2);
    }, 500);
  }, [instruction]);

  useEffect(() => {
    run();
    return clearTimers;
  }, [run]);

  const speaking = phase === "speaking" && typed < instruction.length;

  return (
    <PreviewPanel>
      {/* Fixed-height, top-aligned block: the card's height changes per phase
          (compact while drafting, tall once the text lands), and inside the
          centering panel that would bob the chip up and down. Anchoring the
          block keeps the chip still — the card only ever grows downward. */}
      <div className="relative flex h-[300px] w-full max-w-[470px] flex-col">
        <div className="flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-3 shadow-sm">
          <span
            className={cn(
              "grid size-[26px] shrink-0 place-items-center rounded-full transition-all duration-200",
              speaking
                ? "bg-brand text-brand-foreground ring-4 ring-brand/25"
                : "bg-brand/10 text-brand",
            )}
          >
            <Mic size={14} />
          </span>
          <span className="min-h-[18px] text-[13.5px]">
            {typed === 0 ? (
              <span className="text-muted-foreground/70">
                {t("onboarding.draft.intro.demoPlaceholder")}
              </span>
            ) : (
              `“${instruction.slice(0, typed)}${typed < instruction.length ? "…" : "”"}`
            )}
          </span>
        </div>
        <div className="flex justify-center py-1 text-muted-foreground/60">
          <ArrowDown size={16} />
        </div>
        <DemoDraftCard
          visible={phase === "drafting" || phase === "done"}
          drafting={phase === "drafting"}
          text={t("onboarding.draft.intro.demoDraft")}
        />
      </div>
      <button
        type="button"
        onClick={run}
        className="absolute right-3 top-3 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-muted-foreground"
      >
        <RefreshCw size={13} />
        {t("onboarding.draft.intro.replay")}
      </button>
    </PreviewPanel>
  );
}

/**
 * "Meet Draft" — the learn screen opening the Draft chapter (cloud only).
 * Rail: concept only (dictation-vs-Draft contrast + one how-to-think line) —
 * NO mechanics or shortcut here; the next three screens teach those by doing.
 * Right: the auto-playing instruction→draft demo. Passive screen — advance
 * lives in the footer.
 */
export function DraftIntroScreen({ onNext, onBack }: DraftIntroScreenProps) {
  const { t } = useTranslation();
  const lead = "font-semibold text-foreground";

  return (
    <SplitScreen
      screen={OnboardingScreen.DraftIntro}
      title={t("onboarding.draft.intro.title")}
      railExtra={
        <div className="mt-[11px] flex max-w-[520px] flex-col gap-4 text-base leading-normal text-muted-foreground">
          <p>
            <b className={lead}>{t("onboarding.draft.intro.contrast1Lead")}</b>{" "}
            {t("onboarding.draft.intro.contrast1Rest")}
          </p>
          <p>
            <b className={lead}>{t("onboarding.draft.intro.contrast2Lead")}</b>{" "}
            {t("onboarding.draft.intro.contrast2Rest")}
          </p>
          <p>{t("onboarding.draft.intro.howTo")}</p>
        </div>
      }
      footer={<NavigationButtons showBack onBack={onBack} onNext={onNext} />}
    >
      <IntroDemo />
    </SplitScreen>
  );
}
