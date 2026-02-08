import React, { useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { DiscoverySource } from "../../../../types/onboarding";
import { toast } from "sonner";

interface DiscoverySourceScreenProps {
  onNext: (source: DiscoverySource, details?: string) => void;
  onBack: () => void;
  initialSource?: DiscoverySource;
  initialDetails?: string;
}

/**
 * Discovery source screen - asks how users found Grizzo
 */
export function DiscoverySourceScreen({
  onNext,
  onBack,
  initialSource,
  initialDetails = "",
}: DiscoverySourceScreenProps) {
  const [selectedSource, setSelectedSource] = useState<DiscoverySource | null>(
    initialSource || null,
  );
  const [otherDetails, setOtherDetails] = useState(initialDetails);

  const sources = [
    {
      id: DiscoverySource.SearchEngine,
      label: "Search engine (Google, Bing, etc.)",
    },
    {
      id: DiscoverySource.SocialMedia,
      label: "Social media (Twitter, LinkedIn, etc.)",
    },
    {
      id: DiscoverySource.WordOfMouth,
      label: "Friend or colleague recommendation",
    },
    {
      id: DiscoverySource.BlogArticle,
      label: "Blog post or article",
    },
    {
      id: DiscoverySource.GitHub,
      label: "GitHub",
    },
    {
      id: DiscoverySource.AIAssistant,
      label: "AI assistant (ChatGPT, Claude, etc.)",
    },
    {
      id: DiscoverySource.Other,
      label: "Other",
    },
  ];

  const handleContinue = () => {
    if (!selectedSource) {
      toast.error("Please select how you discovered Vox");
      return;
    }

    if (selectedSource === DiscoverySource.Other && !otherDetails.trim()) {
      toast.error("Please provide details for 'Other'");
      return;
    }

    onNext(
      selectedSource,
      selectedSource === DiscoverySource.Other ? otherDetails : undefined,
    );
  };

  return (
    <OnboardingLayout
      title="How did you discover Vox?"
      subtitle="This helps us understand where our users come from"
      footer={
        <NavigationButtons
          onBack={onBack}
          onNext={handleContinue}
          disableNext={
            !selectedSource ||
            (selectedSource === DiscoverySource.Other && !otherDetails.trim())
          }
        />
      }
    >
      <div className="space-y-6">
        {/* Discovery Sources */}
        <RadioGroup
          value={selectedSource || ""}
          onValueChange={(value) => setSelectedSource(value as DiscoverySource)}
          className="space-y-3"
        >
          {sources.map((source) => (
            <div key={source.id} className="flex items-center space-x-3">
              <RadioGroupItem value={source.id} id={source.id} />
              <Label
                htmlFor={source.id}
                className="flex-1 cursor-pointer font-normal"
              >
                {source.label}
              </Label>
            </div>
          ))}
        </RadioGroup>

        {/* Other Details Input */}
        {selectedSource === DiscoverySource.Other && (
          <div className="space-y-2">
            <Label htmlFor="other-details">Please specify</Label>
            <Input
              id="other-details"
              placeholder="Tell us more..."
              value={otherDetails}
              onChange={(e) => setOtherDetails(e.target.value)}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              {otherDetails.length}/100 characters
            </p>
          </div>
        )}
      </div>
    </OnboardingLayout>
  );
}
