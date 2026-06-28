import { useState } from "react";
import { ArrowRight, Globe, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SplitScreen, PreviewPanel, CardActions } from "../shared/SplitScreen";
import { NavigationButtons } from "../shared/NavigationButtons";
import { ObButton } from "../shared/ui";
import { ChangeModal } from "../shared/ChangeModal";
import { LanguageSettings } from "@/renderer/main/pages/settings/dictation/components/LanguageSettings";
import { labelForLanguage } from "@/constants/languages";
import { OnboardingScreen } from "@/types/onboarding";
import { api } from "@/trpc/react";

interface SpokenLanguageScreenProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * "Which languages do you speak?" — shows the languages Amical will transcribe
 * as chips, with a "Change languages" action that hosts the real
 * <LanguageSettings/> inside the shared ChangeModal. Closing the modal
 * invalidates getDictationSettings so the chips refresh.
 */
export function SpokenLanguageScreen({
  onNext,
  onBack,
}: SpokenLanguageScreenProps) {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const { data: dictationSettings } =
    api.settings.getDictationSettings.useQuery();
  const [modalOpen, setModalOpen] = useState(false);

  const languages = dictationSettings?.languages ?? [];
  const autoDetectEnabled = dictationSettings?.autoDetectEnabled ?? false;
  const canContinue = autoDetectEnabled || languages.length > 0;

  const handleModalOpenChange = (open: boolean) => {
    setModalOpen(open);
    if (!open) {
      utils.settings.getDictationSettings.invalidate();
    }
  };

  const langChip =
    "inline-flex items-center gap-1.5 rounded-full border border-brand/35 bg-brand/10 px-[13px] py-1.5 text-[13px] font-medium text-brand dark:border-brand/45 dark:bg-brand/15 dark:text-brand-foreground";

  return (
    <SplitScreen
      screen={OnboardingScreen.SpokenLanguage}
      title={t("onboarding.spokenLanguage.title")}
      subtitle={t("onboarding.spokenLanguage.subtitle")}
      hint={
        <>
          <Lightbulb size={15} />
          <span>{t("onboarding.spokenLanguage.hint")}</span>
        </>
      }
      footer={<NavigationButtons showNext={false} showBack onBack={onBack} />}
    >
      <PreviewPanel>
        <div className="relative flex min-h-[38px] max-w-[320px] flex-wrap items-center justify-center gap-2">
          {autoDetectEnabled ? (
            <span className={langChip}>
              {t("onboarding.spokenLanguage.autoDetect")}
            </span>
          ) : languages.length ? (
            languages.map((code) => (
              <span key={code} className={langChip}>
                {labelForLanguage(code)}
              </span>
            ))
          ) : (
            <span className="text-[13px] text-muted-foreground/70">
              {t("onboarding.spokenLanguage.none")}
            </span>
          )}
        </div>
        <CardActions>
          <ObButton variant="soft" onClick={() => setModalOpen(true)}>
            <Globe size={16} />
            {t("onboarding.spokenLanguage.change")}
          </ObButton>
          <ObButton onClick={onNext} disabled={!canContinue}>
            {t("onboarding.navigation.continue")}
            <ArrowRight size={16} />
          </ObButton>
        </CardActions>
      </PreviewPanel>

      <ChangeModal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        title={t("onboarding.spokenLanguage.change")}
      >
        <LanguageSettings />
      </ChangeModal>
    </SplitScreen>
  );
}
