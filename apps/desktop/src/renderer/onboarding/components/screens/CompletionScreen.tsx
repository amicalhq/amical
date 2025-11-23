import React from "react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { OnboardingMicrophoneSelect } from "../shared/OnboardingMicrophoneSelect";
import { OnboardingShortcutInput } from "../shared/OnboardingShortcutInput";
import { CheckCircle, Settings, Info } from "lucide-react";
import { FeatureInterest, ModelType } from "../../../../types/onboarding";

interface CompletionScreenProps {
  onComplete: () => void;
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
  preferences,
}: CompletionScreenProps) {
  return (
    <OnboardingLayout title="Setup Complete!">
      <div className="space-y-6">
        {/* Success Message */}
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="rounded-full bg-green-500/10 p-4">
            <CheckCircle className="h-12 w-12 text-green-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold">You're all set!</h2>
            <p className="text-muted-foreground">
              Your voice transcription assistant is ready to use
            </p>
          </div>
        </div>

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

        {/* Next Steps */}
        <Card className="border-primary/20 bg-primary/5 p-6">
          <h3 className="mb-3 font-medium">You're All Set!</h3>
          <div className="space-y-2">
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

        {/* Complete Button */}
        <NavigationButtons
          onComplete={onComplete}
          showBack={false}
          showNext={false}
          showComplete={true}
          completeLabel="Start Using Amical"
        />
      </div>
    </OnboardingLayout>
  );
}
