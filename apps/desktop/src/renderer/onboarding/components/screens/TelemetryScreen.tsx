import { useState } from "react";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { SelectChip } from "../shared/ui";
import { OnboardingScreen } from "../../../../types/onboarding";

interface TelemetryScreenProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * Local setup step: share usage data or not. Telemetry stays off until the
 * user chooses (Cloud users get it on with sign-in instead). Nothing is
 * preselected; the choice saves on Continue.
 */
export function TelemetryScreen({ onNext, onBack }: TelemetryScreenProps) {
  const { t } = useTranslation();
  const telemetryQuery = api.settings.getTelemetrySettings.useQuery();
  const [choice, setChoice] = useState<boolean | null>(null);
  // Back from a later step shows the saved choice.
  const selected = choice ?? telemetryQuery.data?.enabled ?? null;

  const openExternal = api.onboarding.openExternal.useMutation();
  const updateTelemetry = api.settings.updateTelemetrySettings.useMutation({
    onSuccess: onNext,
    onError: (error) => {
      console.error("Failed to save telemetry choice:", error);
      toast.error(t("onboarding.toast.savePreferencesFailed"));
    },
  });

  return (
    <OnboardingLayout
      screen={OnboardingScreen.Telemetry}
      title={t("onboarding.telemetry.title")}
      subtitle={t("onboarding.telemetry.subtitle")}
      footer={
        <NavigationButtons
          onBack={onBack}
          onNext={() => {
            if (selected !== null)
              updateTelemetry.mutate({ enabled: selected });
          }}
          disableNext={selected === null || updateTelemetry.isPending}
        />
      }
    >
      <div className="flex w-full max-w-[360px] animate-ob-rise flex-col gap-[11px]">
        {([true, false] as const).map((share) => (
          <SelectChip
            key={String(share)}
            selected={selected === share}
            className="w-full rounded-2xl px-5 py-4 font-semibold"
            onClick={() => setChoice(share)}
          >
            {t(
              share
                ? "onboarding.telemetry.share"
                : "onboarding.telemetry.decline",
            )}
          </SelectChip>
        ))}
        <button
          type="button"
          onClick={() =>
            openExternal.mutate({ url: "https://amical.ai/docs/telemetry" })
          }
          className="mt-1 self-start text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          {t("settings.advanced.telemetry.learnMore")}
        </button>
      </div>
    </OnboardingLayout>
  );
}
