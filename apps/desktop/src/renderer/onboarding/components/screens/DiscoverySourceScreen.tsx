import React, { useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { DiscoverySource } from "../../../../types/onboarding";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface DiscoverySourceScreenProps {
  onNext: (source: DiscoverySource, details?: string) => void;
  onBack: () => void;
  initialSource?: DiscoverySource;
  initialDetails?: string;
}

/**
 * Discovery source screen - asks how users found Amical
 */
export function DiscoverySourceScreen({
  onNext,
  onBack,
  initialSource,
  initialDetails = "",
}: DiscoverySourceScreenProps) {
  const { t } = useTranslation();
  const [selectedSource, setSelectedSource] = useState<DiscoverySource | null>(
    initialSource || null,
  );
  const [otherDetails, setOtherDetails] = useState(initialDetails);
  const maxOtherDetailsLength = 200;

  const sources = [
    {
      id: DiscoverySource.SearchEngine,
      label: t("onboarding.discovery.sources.searchEngine"),
    },
    {
      id: DiscoverySource.SocialMedia,
      label: t("onboarding.discovery.sources.socialMedia"),
    },
    {
      id: DiscoverySource.WordOfMouth,
      label: t("onboarding.discovery.sources.wordOfMouth"),
    },
    {
      id: DiscoverySource.BlogArticle,
      label: t("onboarding.discovery.sources.blogArticle"),
    },
    {
      id: DiscoverySource.GitHub,
      label: t("onboarding.discovery.sources.github"),
    },
    {
      id: DiscoverySource.AIAssistant,
      label: t("onboarding.discovery.sources.aiAssistant"),
    },
    {
      id: DiscoverySource.Other,
      label: t("onboarding.discovery.sources.other"),
    },
  ];

  const handleContinue = () => {
    if (!selectedSource) {
      toast.error(t("onboarding.discovery.toast.selectSource"));
      return;
    }

    if (selectedSource === DiscoverySource.Other && !otherDetails.trim()) {
      toast.error(t("onboarding.discovery.toast.otherDetailsRequired"));
      return;
    }

    onNext(
      selectedSource,
      selectedSource === DiscoverySource.Other ? otherDetails : undefined,
    );
  };

  return (
    <OnboardingLayout
      title={t("onboarding.discovery.title")}
      subtitle={t("onboarding.discovery.subtitle")}
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
            <Label htmlFor="other-details">
              {t("onboarding.discovery.other.label")}
            </Label>
            <Input
              id="other-details"
              placeholder={t("onboarding.discovery.other.placeholder")}
              value={otherDetails}
              onChange={(e) => setOtherDetails(e.target.value)}
              maxLength={maxOtherDetailsLength}
            />
            <p className="text-xs text-muted-foreground">
              {t("onboarding.discovery.other.charCount", {
                count: otherDetails.length,
                max: maxOtherDetailsLength,
              })}
            </p>
          </div>
        )}
      </div>
    </OnboardingLayout>
  );
}
