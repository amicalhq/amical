import { useState } from "react";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { SelectChip } from "../shared/ui";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Mail,
  MessageSquare,
  Sparkles,
  Code,
  FileText,
  StickyNote,
  Globe,
} from "lucide-react";
import {
  FeatureInterest,
  OnboardingScreen,
} from "../../../../types/onboarding";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface WelcomeScreenProps {
  onNext: (interests: FeatureInterest[], details?: string) => void;
  initialInterests?: FeatureInterest[];
}

/**
 * Welcome screen — first screen of onboarding. Asks how the user will use
 * Amical via multi-select activity chips; "Something else" reveals a free-text
 * input (telemetry-only, like discovery's Other details).
 */
export function WelcomeScreen({
  onNext,
  initialInterests = [],
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<FeatureInterest>>(
    new Set(initialInterests),
  );
  const [details, setDetails] = useState("");

  const useCases: {
    id: FeatureInterest;
    icon?: typeof Mail;
    label: string;
  }[] = [
    {
      id: FeatureInterest.DraftingEmails,
      icon: Mail,
      label: t("onboarding.welcome.useCases.draftingEmails"),
    },
    {
      id: FeatureInterest.SendingMessages,
      icon: MessageSquare,
      label: t("onboarding.welcome.useCases.sendingMessages"),
    },
    {
      id: FeatureInterest.PromptingAi,
      icon: Sparkles,
      label: t("onboarding.welcome.useCases.promptingAi"),
    },
    {
      id: FeatureInterest.CodingWithAi,
      icon: Code,
      label: t("onboarding.welcome.useCases.codingWithAi"),
    },
    {
      id: FeatureInterest.WritingDocuments,
      icon: FileText,
      label: t("onboarding.welcome.useCases.writingDocuments"),
    },
    {
      id: FeatureInterest.TakingNotes,
      icon: StickyNote,
      label: t("onboarding.welcome.useCases.takingNotes"),
    },
    {
      id: FeatureInterest.PostsComments,
      icon: Globe,
      label: t("onboarding.welcome.useCases.postsComments"),
    },
    {
      id: FeatureInterest.SomethingElse,
      label: t("onboarding.welcome.useCases.somethingElse"),
    },
  ];

  const somethingElse = selected.has(FeatureInterest.SomethingElse);

  const toggle = (id: FeatureInterest) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const handleContinue = () => {
    if (selected.size === 0) {
      toast.error(t("onboarding.welcome.toast.selectAtLeastOne"));
      return;
    }
    onNext(
      Array.from(selected),
      somethingElse && details.trim() ? details.trim() : undefined,
    );
  };

  return (
    <OnboardingLayout
      screen={OnboardingScreen.Welcome}
      title={t("onboarding.welcome.title")}
      subtitle={t("onboarding.welcome.subtitle")}
      footer={
        <NavigationButtons
          showBack={false}
          onNext={handleContinue}
          disableNext={selected.size === 0}
        />
      }
    >
      <div className="max-w-[560px] animate-ob-rise">
        <div className="flex flex-wrap gap-[9px]">
          {useCases.map(({ id, icon: Icon, label }) => {
            const isSelected = selected.has(id);
            return (
              <SelectChip
                key={id}
                selected={isSelected}
                onClick={() => toggle(id)}
              >
                {Icon && (
                  <Icon
                    size={15}
                    className={cn(
                      isSelected ? "text-indigo-500" : "text-muted-foreground",
                    )}
                  />
                )}
                {label}
              </SelectChip>
            );
          })}
        </div>
        {somethingElse && (
          <Input
            className="mt-4 max-w-[340px]"
            placeholder={t("onboarding.welcome.somethingElsePlaceholder")}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={200}
          />
        )}
      </div>
    </OnboardingLayout>
  );
}
