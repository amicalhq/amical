import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ObButton, SkipPill } from "./ui";

interface NavigationButtonsProps {
  onBack?: () => void;
  onNext?: () => void;
  onComplete?: () => void;
  onSkip?: () => void;
  showBack?: boolean;
  /** Passive screens show the footer Continue. Configure/try-it set this false
   *  (their advance lives inside the instrument card). */
  showNext?: boolean;
  showComplete?: boolean;
  showSkip?: boolean;
  disableNext?: boolean;
  completeLabel?: string;
}

/**
 * The bottom nav row. Back on the left; Skip (escape hatch) and the primary
 * Continue/Complete on the right. When `showNext` is false the right side
 * holds at most Skip — used by Configure/try-it screens whose gated advance
 * is in the card.
 */
export function NavigationButtons({
  onBack,
  onNext,
  onComplete,
  onSkip,
  showBack = true,
  showNext = true,
  showComplete = false,
  showSkip = false,
  disableNext = false,
  completeLabel,
}: NavigationButtonsProps) {
  const { t } = useTranslation();
  const resolvedCompleteLabel =
    completeLabel ?? t("onboarding.navigation.done");

  return (
    <div className="flex shrink-0 items-center justify-between pb-7 pt-[18px]">
      <div className="flex items-center gap-3">
        <ObButton
          variant="ghost"
          onClick={onBack}
          style={{ visibility: showBack ? "visible" : "hidden" }}
        >
          <ArrowLeft size={16} />
          {t("onboarding.navigation.back")}
        </ObButton>
      </div>
      <div className="flex items-center gap-3">
        {showSkip && (
          <SkipPill onClick={onSkip}>
            {t("onboarding.navigation.skip")}
          </SkipPill>
        )}
        {showNext && !showComplete && (
          <ObButton onClick={onNext} disabled={disableNext}>
            {t("onboarding.navigation.continue")}
            <ArrowRight size={16} />
          </ObButton>
        )}
        {showComplete && (
          <ObButton onClick={onComplete}>
            <Check size={16} />
            {resolvedCompleteLabel}
          </ObButton>
        )}
      </div>
    </div>
  );
}
