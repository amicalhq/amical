import { useState } from "react";
import { Input } from "@/components/ui/input";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { SelectChip } from "../shared/ui";
import {
  DiscoverySource,
  OnboardingScreen,
} from "../../../../types/onboarding";
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
      id: DiscoverySource.Reddit,
      label: t("onboarding.discovery.sources.reddit"),
    },
    {
      id: DiscoverySource.XTwitter,
      label: t("onboarding.discovery.sources.xTwitter"),
    },
    {
      id: DiscoverySource.SocialMedia,
      label: t("onboarding.discovery.sources.socialMedia"),
    },
    {
      id: DiscoverySource.AIAssistant,
      label: t("onboarding.discovery.sources.aiAssistant"),
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
      screen={OnboardingScreen.DiscoverySource}
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
      <div className="flex max-w-[560px] animate-ob-rise flex-wrap gap-[9px]">
        {sources.map((source) => (
          <SelectChip
            key={source.id}
            selected={selectedSource === source.id}
            onClick={() => setSelectedSource(source.id)}
          >
            {source.label}
          </SelectChip>
        ))}
      </div>

      {selectedSource === DiscoverySource.Other && (
        <div className="mt-4 max-w-[560px] space-y-2">
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
    </OnboardingLayout>
  );
}
