import React from "react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { OnboardingMicrophoneSelect } from "../shared/OnboardingMicrophoneSelect";
import { OnboardingShortcutInput } from "../shared/OnboardingShortcutInput";
import { CheckCircle, Settings, Info } from "lucide-react";
interface CompletionScreenProps {
  onComplete: () => void;
  onBack: () => void;
}

/**
 * Completion screen - final screen showing setup is complete
 */
export function CompletionScreen({
  onComplete,
  onBack,
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
          completeLabel="Start Using Grizzo"
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
          </p>
        </div>
      </div>
    </OnboardingLayout>
  );
}
