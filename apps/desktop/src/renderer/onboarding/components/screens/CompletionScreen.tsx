import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { OnboardingMicrophoneSelect } from "../shared/OnboardingMicrophoneSelect";
import { OnboardingShortcutInput } from "../shared/OnboardingShortcutInput";
import { CheckCircle, Settings, Info } from "lucide-react";
import { FeatureInterest, ModelType } from "../../../../types/onboarding";
import { useTranslation } from "react-i18next";
import { api } from "@/trpc/react";

const DISCORD_URL = "https://amical.ai/community";

interface CompletionScreenProps {
  onComplete: () => void;
  onBack: () => void;
  preferences: {
    featureInterests?: FeatureInterest[];
    modelType?: ModelType;
  };
}

/**
 * Completion screen - final screen showing setup is complete
 */
export function CompletionScreen({
  onComplete,
  onBack,
  preferences,
}: CompletionScreenProps) {
  const { t } = useTranslation();
  const openExternal = api.onboarding.openExternal.useMutation();
  return (
    <OnboardingLayout
      title={t("onboarding.completion.title")}
      titleIcon={<CheckCircle className="h-7 w-7 text-green-500" />}
      footer={
        <NavigationButtons
          onComplete={onComplete}
          onBack={onBack}
          showBack={true}
          showNext={false}
          showComplete={true}
          completeLabel={t("onboarding.completion.start")}
        />
      }
    >
      <div className="space-y-6">
        {/* Quick Configuration */}
        <Card className="p-6">
          <h3 className="mb-4 font-medium flex items-center gap-2">
            <Settings className="h-4 w-4" />
            {t("onboarding.completion.quickConfig.title")}
          </h3>
          <div className="space-y-4">
            <OnboardingMicrophoneSelect />
            <Separator />
            <OnboardingShortcutInput />
          </div>
        </Card>

        {/* Community */}
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-[#5865F2]/10 p-3">
              <img
                src="icons/integrations/discord.svg"
                alt={t("onboarding.completion.community.discordAlt")}
                className="h-6 w-6"
              />
            </div>
            <div className="flex-1">
              <h3 className="font-medium">
                {t("onboarding.completion.community.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("onboarding.completion.community.description")}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => openExternal.mutate({ url: DISCORD_URL })}
            >
              {t("onboarding.completion.community.joinDiscord")}
            </Button>
          </div>
        </Card>

        {/* Next Steps */}
        <Card className="border-primary/20 bg-primary/5 px-6 gap-2">
          <h3 className="font-medium">
            {t("onboarding.completion.next.title")}
          </h3>
          <div>
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-primary">•</span>
              <p className="text-sm">
                {t("onboarding.completion.next.items.pushToTalk")}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-primary">•</span>
              <p className="text-sm">
                {t("onboarding.completion.next.items.widget")}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-primary">•</span>
              <p className="text-sm">
                {t("onboarding.completion.next.items.settings")}
              </p>
            </div>
          </div>
        </Card>

        {/* Info Note */}
        <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
          <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("onboarding.completion.info")}
            {preferences.modelType === ModelType.Local
              ? ` ${t("onboarding.completion.infoLocalModel")}`
              : ""}
          </p>
        </div>
      </div>
    </OnboardingLayout>
  );
}
