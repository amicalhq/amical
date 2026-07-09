import { useEffect, useRef, useState } from "react";
import { ArrowRight, Mic, TextSelect } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SplitScreen } from "../shared/SplitScreen";
import { NavigationButtons } from "../shared/NavigationButtons";
import { ObButton } from "../shared/ui";
import { CoachBubble } from "../shared/CoachBubble";
import { useOnboardingDictation } from "../shared/useOnboardingDictation";
import {
  ONBOARDING_WINDOW_TITLE,
  TRY_IT_WINDOW_TITLES,
} from "@/constants/window-titles";
import { getKeycodeFromKeyName } from "@/utils/keycode-map";
import { api } from "@/trpc/react";
import { OnboardingScreen } from "../../../../types/onboarding";

interface DraftTestScreenProps {
  variant: "compose" | "selection";
  onNext: () => void;
  onBack: () => void;
}

/**
 * Live Draft try-it: same compose-sheet anatomy as the dictation try-its, but
 * driven by the Draft shortcut and the full production Draft pipeline — the
 * user holds the Draft chord, speaks an instruction, and the REAL review
 * window pops at the bottom of the screen; Insert pastes into this textarea
 * because it's the focused field of the frontmost app.
 *
 * compose:   empty email body — "say what you want" and insert the draft.
 * selection: the body is pre-filled with a blunt reply; a hint marker asks the
 *            user to select it THEMSELVES (that's the lesson). The stop-time
 *            selected-text capture feeds the selection to the instruction, and
 *            Insert pastes over it, replacing it in place.
 */
export function DraftTestScreen({
  variant,
  onNext,
  onBack,
}: DraftTestScreenProps) {
  const { t } = useTranslation();
  const { isRecording, isDraftTake, isIdle } = useOnboardingDictation();
  // Draft-take only: plain push-to-talk also records (and still pastes into
  // the sheet), but it isn't the lesson — the bubble must not light for it.
  const isDrafting = isRecording && isDraftTake;

  // While the generated draft is held in the review window, the bubble flips
  // to the insert cue (Enter) — the review UI itself lives at the bottom of
  // the SCREEN, outside this window, so the sheet needs its own pointer.
  // Gated on idle so it mirrors main's Enter arming (pendingDraft && idle):
  // during a sticky re-dictation the old draft stays pending through the
  // recording AND the post-release generation, and Enter is disarmed for that
  // whole stretch — the cue must not point at a dead key.
  // (Leaving the screen dismisses any held review or in-flight take — the
  // try-it deactivation handler in app-manager does the ESC-equivalent
  // cleanup, so nothing here needs to.)
  const [draftPending, setDraftPending] = useState(false);
  api.recording.draftReview.useSubscription(undefined, {
    onData: (draft) => setDraftPending(draft !== null),
  });
  const showInsertCue = draftPending && isIdle;
  const enterCode = getKeycodeFromKeyName("Enter");

  const { data: shortcuts } = api.settings.getShortcuts.useQuery();
  const configured = shortcuts?.draftMode ?? [];
  const screen = {
    compose: OnboardingScreen.DraftCompose,
    selection: OnboardingScreen.DraftSelection,
  }[variant];
  const ns = `onboarding.draft.${variant}`;

  const seed = variant === "selection" ? t(`${ns}.seedText`) : "";
  const [text, setText] = useState(seed);
  // compose: any text counts; selection: only a CHANGE counts (the seed alone
  // must not unlock Continue).
  const canContinue = text.trim().length > 0 && text !== seed;

  // Outcome means "they drafted": a take happened on this screen AND the field
  // holds (changed) text at exit — same button-agnostic contract as the
  // dictation try-its.
  const sawTakeRef = useRef(false);
  const trackStepResult = api.onboarding.trackStepResult.useMutation();
  const finishStep = () => {
    trackStepResult.mutate({
      screen,
      outcome: sawTakeRef.current && canContinue ? "completed" : "skipped",
    });
    onNext();
  };

  // Both variants depict an email surface; the title feeds the accessibility
  // context so the generation formats as email prose (see window-titles.ts).
  useEffect(() => {
    document.title = TRY_IT_WINDOW_TITLES.email;
    return () => {
      document.title = ONBOARDING_WINDOW_TITLE;
    };
  }, []);

  // Selecting the seed is the user's own first step (that's the lesson), so
  // nothing is pre-selected — a hint marker points at the text until they do.
  // Selection is read off the textarea's select events; it survives holding
  // the shortcut (the capture happens at stop time), so the marker stays
  // useful even mid-take.
  const [hasSelection, setHasSelection] = useState(false);
  const showSelectHint =
    variant === "selection" && !hasSelection && text === seed;

  // The selected-text capture and the paste both target the focused element,
  // so the textarea must hold focus while a take is in flight — reclaim it
  // when recording starts in case the user clicked elsewhere in the window.
  // Only a DRAFT take counts toward the step outcome (isDrafting flips true
  // mid-recording when the draft tag latches, re-running this effect).
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (isRecording) {
      areaRef.current?.focus();
    }
    if (isDrafting) {
      sawTakeRef.current = true;
    }
  }, [isRecording, isDrafting]);

  const fieldClass = "border-b border-zinc-100 py-[11px] text-sm text-zinc-600";

  return (
    <SplitScreen
      screen={screen}
      title={t(`${ns}.title`)}
      subtitle={t(`${ns}.subtitle`)}
      hint={
        // Mic, not bulb: these hints are example utterances ("say this"), not
        // advice — same spoken-content vocabulary as the intro demo's mic chip.
        <>
          <Mic size={15} />
          <span>{t(`${ns}.tip`)}</span>
        </>
      }
      footer={
        <NavigationButtons
          showBack
          onBack={onBack}
          showNext={false}
          showSkip
          onSkip={finishStep}
        />
      }
    >
      <div className="relative flex self-stretch">
        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-white text-zinc-900 shadow-2xl shadow-brand/20">
          <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-3 py-[9px] text-center text-xs font-semibold text-zinc-500">
            {t(`${ns}.mockHeader`)}
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-6 pt-1.5">
            <div className={fieldClass}>{t(`${ns}.to`)}</div>
            <div className={fieldClass}>{t(`${ns}.subject`)}</div>
            <div className="relative flex min-h-0 flex-1 flex-col">
              <textarea
                ref={areaRef}
                autoFocus
                spellCheck={false}
                className="w-full flex-1 resize-none border-0 bg-transparent py-4 text-[15.5px] leading-[1.65] text-zinc-900 caret-brand outline-none placeholder:text-zinc-400"
                placeholder={
                  variant === "compose" ? t(`${ns}.ghost`) : undefined
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                onSelect={(e) =>
                  setHasSelection(
                    e.currentTarget.selectionStart !==
                      e.currentTarget.selectionEnd,
                  )
                }
              />
              {/* points at the seed line (one line at this sheet width) until
                  the user makes a selection of their own */}
              {showSelectHint && (
                <div className="pointer-events-none absolute left-1 top-[46px] z-10 flex animate-ob-rise items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-[12.5px] font-bold text-white shadow-lg shadow-black/30">
                  <span
                    className="absolute -top-1 left-5 size-2 rotate-45 bg-zinc-900"
                    aria-hidden
                  />
                  <TextSelect size={14} />
                  {t(`${ns}.selectHint`)}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50 px-4 py-3">
            <ObButton disabled={!canContinue} onClick={finishStep}>
              {t("onboarding.navigation.continue")}
              <ArrowRight size={16} />
            </ObButton>
          </div>
        </div>
        <CoachBubble
          ctaKey={showInsertCue ? "onboarding.draft.insertCta" : `${ns}.cta`}
          recording={isDrafting}
          shortcut={
            showInsertCue
              ? enterCode !== undefined
                ? [enterCode]
                : []
              : configured
          }
        />
      </div>
    </SplitScreen>
  );
}
