import { useEffect, useRef, useState } from "react";
import { ArrowRight, Lightbulb } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { OnboardingScreen } from "../../../../types/onboarding";

interface DictationTestScreenProps {
  variant: "email" | "notes" | "simple";
  onNext: () => void;
  onBack: () => void;
}

/**
 * Live dictation try-it: the pane is a generic compose sheet (titled, no OS
 * chrome — platform-neutral) holding a REAL auto-focused textarea. The user
 * holds their actual push-to-talk shortcut and the full production pipeline
 * runs — recording widget, sounds, transcription, and the native paste, which
 * lands in this textarea because it's the focused field of the frontmost app.
 * Continue unlocks once text is in the field. Skip always advances. The sheet
 * depicts an app surface, so it stays light in both themes.
 */
export function DictationTestScreen({
  variant,
  onNext,
  onBack,
}: DictationTestScreenProps) {
  const { t } = useTranslation();
  const { isRecording } = useOnboardingDictation();
  const { data: shortcuts } = api.settings.getShortcuts.useQuery();
  const configured = shortcuts?.pushToTalk ?? [];
  const screen = {
    email: OnboardingScreen.DictationEmail,
    notes: OnboardingScreen.DictationNotes,
    simple: OnboardingScreen.DictationLocal,
  }[variant];
  const ns = `onboarding.dictationTest.${variant}`;

  const [text, setText] = useState("");
  const canContinue = text.trim().length > 0;

  // Outcome means "they dictated": a recording happened on this screen AND
  // text is in the field at exit. Neither alone is enough — the textarea is
  // typeable, so text without a take is someone typing past the step, and a
  // take without text is an empty/failed transcript. Button-agnostic:
  // skipping forward after a successful take still counts as completed.
  const sawTakeRef = useRef(false);
  const trackStepResult = api.onboarding.trackStepResult.useMutation();
  const finishStep = () => {
    trackStepResult.mutate({
      screen,
      outcome: sawTakeRef.current && canContinue ? "completed" : "skipped",
    });
    onNext();
  };

  // The window title doubles as the surface signal for context building: the
  // native helper reads it into the accessibility context, and the formatter
  // maps it so the demo formats like the app it depicts — email prose / notes
  // list — instead of as Amical's own Markdown-notes surface. The visible
  // sheet header is separate, localized copy. The simple (local) variant
  // keeps the base title: verbatim demo, generic surface.
  useEffect(() => {
    const surface = variant === "simple" ? null : TRY_IT_WINDOW_TITLES[variant];
    if (!surface) return;
    document.title = surface;
    return () => {
      document.title = ONBOARDING_WINDOW_TITLE;
    };
  }, [variant]);

  // The paste targets the focused element, so the textarea must hold focus
  // while a take is in flight — reclaim it when recording starts in case the
  // user clicked elsewhere in the window.
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (isRecording) {
      sawTakeRef.current = true;
      areaRef.current?.focus();
    }
  }, [isRecording]);

  const fieldClass = "border-b border-zinc-100 py-[11px] text-sm text-zinc-600";

  return (
    <SplitScreen
      screen={screen}
      title={t(`${ns}.title`)}
      subtitle={t(`${ns}.subtitle`)}
      hint={
        <>
          <Lightbulb size={15} />
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
            {variant === "email" && (
              <>
                <div className={fieldClass}>
                  {t("onboarding.dictationTest.email.to")}
                </div>
                <div className={fieldClass}>
                  {t("onboarding.dictationTest.email.subject")}
                </div>
              </>
            )}
            {variant === "notes" && (
              <div className={cn(fieldClass, "font-semibold text-zinc-900")}>
                {t("onboarding.dictationTest.notes.listTitle")}
              </div>
            )}
            <textarea
              ref={areaRef}
              autoFocus
              spellCheck={false}
              className="w-full flex-1 resize-none border-0 bg-transparent py-4 text-[15.5px] leading-[1.65] text-zinc-900 caret-brand outline-none placeholder:text-zinc-400"
              placeholder={t(`${ns}.ghost`)}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50 px-4 py-3">
            <ObButton disabled={!canContinue} onClick={finishStep}>
              {t("onboarding.navigation.continue")}
              <ArrowRight size={16} />
            </ObButton>
          </div>
        </div>
        <CoachBubble
          ctaKey={`${ns}.cta`}
          recording={isRecording}
          shortcut={configured}
        />
      </div>
    </SplitScreen>
  );
}
