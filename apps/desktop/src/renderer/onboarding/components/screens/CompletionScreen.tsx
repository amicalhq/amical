import React from "react";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { InfoRow } from "../shared/ui";
import { KeycapSentence, KEYS_SENTINEL } from "../shared/KeyCap";
import { Sparkles, Check, Cpu, Cloud, Keyboard, Mic } from "lucide-react";
import { ModelType, OnboardingScreen } from "../../../../types/onboarding";
import { findInstalledLocalModel } from "@/constants/models";
import { useTranslation } from "react-i18next";
import { api } from "@/trpc/react";
import { useActiveMicrophone } from "@/hooks/useActiveMicrophone";

interface CompletionScreenProps {
  onComplete: () => void;
  onBack: () => void;
  modelType: ModelType;
}

/**
 * "Done" — celebrate mark + setup summary (speech model / shortcut / microphone)
 * + "Start using Amical". Mic and shortcut are configured in their own earlier
 * steps now, so this screen only reflects the final setup.
 */
export function CompletionScreen({
  onComplete,
  onBack,
  modelType,
}: CompletionScreenProps) {
  const { t } = useTranslation();
  const { data: shortcuts } = api.settings.getShortcuts.useQuery();

  const isLocal = modelType === ModelType.Local;
  // Name the model that's actually installed rather than assuming the
  // recommended one.
  const { data: downloadedModels } = api.models.getDownloadedModels.useQuery(
    undefined,
    { enabled: isLocal },
  );
  const installedModel = findInstalledLocalModel(downloadedModels);
  const speechValue = isLocal
    ? t("onboarding.completion.summary.localModel", {
        model: installedModel?.name || installedModel?.id || "Whisper",
      })
    : t("onboarding.completion.summary.cloudModel");
  const SpeechIcon = isLocal ? Cpu : Cloud;

  const shortcutValue = (
    <KeycapSentence
      className="gap-1"
      sentence={t("onboarding.completion.summary.shortcutValue", {
        key: KEYS_SENTINEL,
      })}
      codes={shortcuts?.pushToTalk ?? []}
      kbdClassName="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs"
    />
  );

  const { label: micValue } = useActiveMicrophone();

  const rows: { icon: typeof Mic; label: string; value: React.ReactNode }[] = [
    {
      icon: SpeechIcon,
      label: t("onboarding.completion.summary.speechModel"),
      value: speechValue,
    },
    {
      icon: Keyboard,
      label: t("onboarding.completion.summary.shortcut"),
      value: shortcutValue,
    },
    {
      icon: Mic,
      label: t("onboarding.completion.summary.microphone"),
      value: micValue,
    },
  ];

  return (
    <OnboardingLayout
      badge={
        <div className="mb-3 grid size-[52px] place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-400 text-white shadow-lg shadow-indigo-500/40">
          <Sparkles size={26} />
        </div>
      }
      screen={OnboardingScreen.Completion}
      title={t("onboarding.completion.title")}
      subtitle={t("onboarding.completion.subtitle")}
      footer={
        <NavigationButtons
          onBack={onBack}
          onComplete={onComplete}
          showBack={true}
          showNext={false}
          showComplete={true}
          completeLabel={t("onboarding.completion.start")}
        />
      }
    >
      <div className="flex w-full max-w-[500px] animate-ob-rise flex-col gap-[9px]">
        {rows.map(({ icon: Icon, label, value }) => (
          <InfoRow
            key={label}
            className="gap-[13px] px-[17px] py-3.5"
            tileClassName="size-[34px]"
            icon={<Icon size={20} />}
            title={label}
            description={value}
            trailing={
              <Check
                size={17}
                className="text-emerald-600 dark:text-emerald-400"
              />
            }
          />
        ))}
      </div>
    </OnboardingLayout>
  );
}
