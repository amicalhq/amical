import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { Mic, FileText, Users, Command } from "lucide-react";
import { FeatureInterest } from "../../../../types/onboarding";
import { toast } from "sonner";

interface WelcomeScreenProps {
  onNext: (interests: FeatureInterest[]) => void;
  onSkip?: () => void;
  initialInterests?: FeatureInterest[];
}

/**
 * Welcome screen - first screen users see in onboarding
 * Introduces Amical and allows users to select features they're interested in
 */
export function WelcomeScreen({
  onNext,
  onSkip,
  initialInterests = [],
}: WelcomeScreenProps) {
  const [selectedInterests, setSelectedInterests] = useState<
    Set<FeatureInterest>
  >(new Set(initialInterests));

  const features = [
    {
      id: FeatureInterest.ContextualDictation,
      title: "Contextual Dictation",
      description:
        "Quick voice input in any application for seamless speech-to-text",
      icon: Mic,
    },
    {
      id: FeatureInterest.NoteTaking,
      title: "Note Taking",
      description:
        "Capture thoughts and ideas through speech with smart formatting",
      icon: FileText,
    },
    {
      id: FeatureInterest.MeetingTranscriptions,
      title: "Meeting Transcriptions",
      description:
        "Record and transcribe meetings and conversations with high accuracy",
      icon: Users,
    },
    {
      id: FeatureInterest.VoiceCommands,
      title: "Voice Commands",
      description:
        "Control your apps hands-free - act on tasks with natural voice commands",
      icon: Command,
    },
  ];

  const handleToggleInterest = (interest: FeatureInterest) => {
    const newInterests = new Set(selectedInterests);
    if (newInterests.has(interest)) {
      newInterests.delete(interest);
    } else {
      // Maximum 4 interests
      if (newInterests.size >= 4) {
        toast.error("You can select up to 4 features");
        return;
      }
      newInterests.add(interest);
    }
    setSelectedInterests(newInterests);
  };

  const handleContinue = () => {
    if (selectedInterests.size === 0) {
      toast.error(
        "Please select at least one feature to personalize your experience",
      );
      return;
    }
    onNext(Array.from(selectedInterests));
  };

  return (
    <OnboardingLayout
      title="Welcome to Vox"
      subtitle="Select the features you're interested in to personalize your experience"
      footer={
        <div className="space-y-4">
          <NavigationButtons
            onNext={handleContinue}
            showBack={false}
            disableNext={selectedInterests.size === 0}
          />
          {onSkip && (
            <div className="text-center">
              <button
                onClick={onSkip}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Skip onboarding
              </button>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Feature Selection Cards */}
        <div className="space-y-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            const isSelected = selectedInterests.has(feature.id);

            return (
              <Card
                key={feature.id}
                className={`cursor-pointer transition-all p-4 ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "hover:border-muted-foreground/50"
                }`}
                onClick={() => handleToggleInterest(feature.id)}
              >
                <div className="relative">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => handleToggleInterest(feature.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-0"
                    aria-label={`Select ${feature.title}`}
                  />
                  <div className="flex items-center gap-3 pr-8">
                    <div
                      className={`rounded-lg p-2 transition-colors ${
                        isSelected ? "bg-primary/10" : "bg-muted"
                      }`}
                    >
                      <Icon
                        className={`h-5 w-5 ${
                          isSelected ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-medium">{feature.title}</h3>
                        {(feature.id ===
                          FeatureInterest.MeetingTranscriptions ||
                          feature.id === FeatureInterest.VoiceCommands) && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                          >
                            Coming Soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Selection Counter */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            {selectedInterests.size === 0
              ? "Select at least one feature"
              : `${selectedInterests.size} selected`}
          </p>
        </div>

        {/* Settings Note */}
        <div className="rounded-lg bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Your choices help personalize setup — all features remain available
            anytime.
          </p>
        </div>
      </div>
    </OnboardingLayout>
  );
}
