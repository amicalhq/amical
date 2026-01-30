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
  return (
    <OnboardingLayout
      title="Setup Complete!"
      titleIcon={<CheckCircle className="h-7 w-7 text-green-500" />}
      footer={
        <NavigationButtons
          onComplete={onComplete}
          onBack={onBack}
          showBack={true}
          showNext={false}
          showComplete={true}
          completeLabel="Start Using Vox"
        />
      }
    >
      <div className="space-y-6">
        {/* Quick Configuration */}
        <Card className="p-6">
          <h3 className="mb-4 font-medium flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Quick Configuration
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
                alt="Discord"
                className="h-6 w-6"
              />
            </div>
            <div className="flex-1">
              <h3 className="font-medium">Join our Community</h3>
              <p className="text-sm text-muted-foreground">
                Get help, share feedback, and connect with other users
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => window.electronAPI.openExternal(DISCORD_URL)}
            >
              Join Discord
            </Button>
          </div>
        </Card>

        {/* Next Steps */}
        <Card className="border-primary/20 bg-primary/5 px-6 gap-2">
          <h3 className="font-medium">You're All Set!</h3>
          <div>
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-primary">•</span>
              <p className="text-sm">
                Use your push-to-talk shortcut to start transcribing
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-primary">•</span>
              <p className="text-sm">
                Click the floating widget for quick access
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-primary">•</span>
              <p className="text-sm">
                Explore Settings for more customization options
              </p>
            </div>
          </div>
        </Card>

        {/* Info Note */}
        <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
          <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            All settings can be changed anytime in the application preferences.
            {preferences.modelType === ModelType.Local &&
              " Your selected local model is ready to use offline."}
          </p>
        </div>
      </div>
    </OnboardingLayout>
  );
}
