import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface NavigationButtonsProps {
  onBack?: () => void;
  onNext?: () => void;
  onComplete?: () => void;
  showBack?: boolean;
  showNext?: boolean;
  showComplete?: boolean;
  disableNext?: boolean;
  disableComplete?: boolean;
  nextLabel?: string;
  completeLabel?: string;
  className?: string;
}

/**
 * Navigation buttons for onboarding flow
 * Provides consistent navigation experience across all screens
 */
export function NavigationButtons({
  onBack,
  onNext,
  onComplete,
  showBack = true,
  showNext = true,
  showComplete = false,
  disableNext = false,
  disableComplete = false,
  nextLabel,
  completeLabel,
  className,
}: NavigationButtonsProps) {
  const { t } = useTranslation();
  const resolvedNextLabel = nextLabel ?? t("onboarding.navigation.continue");
  const resolvedCompleteLabel =
    completeLabel ?? t("onboarding.navigation.complete");

  return (
    <div
      className={cn(
        "flex items-center justify-between pt-4",
        !showBack && "justify-end",
        className,
      )}
    >
      {/* Back Button */}
      {showBack && (
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2"
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("onboarding.navigation.back")}
        </Button>
      )}

      {/* Next/Complete Button */}
      <div className="flex gap-3">
        {showNext && !showComplete && (
          <Button
            onClick={onNext}
            disabled={disableNext}
            className="gap-2"
            type="button"
          >
            {resolvedNextLabel}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}

        {showComplete && (
          <Button
            onClick={onComplete}
            disabled={disableComplete}
            className="gap-2"
            type="button"
          >
            <Check className="h-4 w-4" />
            {resolvedCompleteLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
