import React from "react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "react-i18next";

interface ProgressIndicatorProps {
  current: number;
  total: number;
  className?: string;
  showSteps?: boolean;
}

/**
 * Progress indicator for onboarding flow
 * Shows current position in the onboarding process
 */
export function ProgressIndicator({
  current,
  total,
  className,
  showSteps = true,
}: ProgressIndicatorProps) {
  const { t } = useTranslation();
  const percentage = Math.round((current / total) * 100);

  return (
    <div className={cn("w-full", className)}>
      {showSteps && (
        <div className="mb-2 flex justify-between text-sm text-muted-foreground">
          <span>{t("onboarding.progress.step", { current, total })}</span>
          <span>
            {t("onboarding.progress.percent", { percent: percentage })}
          </span>
        </div>
      )}
      <Progress value={percentage} className="h-2" />
    </div>
  );
}
