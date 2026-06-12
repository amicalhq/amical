import { useState } from "react";
import { ArrowRight, Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SplitScreen,
  PreviewPanel,
  Verdict,
  CardActions,
} from "../shared/SplitScreen";
import { NavigationButtons } from "../shared/NavigationButtons";
import { ObButton } from "../shared/ui";
import { ChangeModal } from "../shared/ChangeModal";
import { KeyCap } from "../shared/KeyCap";
import { useHeldKeys } from "../shared/useHeldKeys";
import { OnboardingShortcutInput } from "../shared/OnboardingShortcutInput";
import { OnboardingScreen } from "@/types/onboarding";
import { api } from "@/trpc/react";

interface ShortcutScreenProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * "Set your dictation shortcut" — the configured push-to-talk key(s) light up
 * indigo only while physically held (no detection state, verified by eye like
 * the mic test). "Change shortcut" opens the shared ChangeModal hosting the
 * real shortcut input.
 */
export function ShortcutScreen({ onNext, onBack }: ShortcutScreenProps) {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const { data: shortcuts } = api.settings.getShortcuts.useQuery();
  const configured = shortcuts?.pushToTalk ?? [];
  const heldKeys = useHeldKeys();
  const [modalOpen, setModalOpen] = useState(false);

  const handleModalOpenChange = (open: boolean) => {
    setModalOpen(open);
    if (!open) {
      utils.settings.getShortcuts.invalidate();
    }
  };

  return (
    <SplitScreen
      screen={OnboardingScreen.Shortcut}
      title={t("onboarding.shortcut.title")}
      subtitle={t("onboarding.shortcut.subtitle")}
      hint={
        <>
          <Keyboard size={15} />
          <span>{t("onboarding.shortcut.hint")}</span>
        </>
      }
      footer={<NavigationButtons showNext={false} showBack onBack={onBack} />}
    >
      <PreviewPanel>
        <div className="relative flex items-center justify-center gap-2">
          {configured.length ? (
            configured.map((code) => (
              <KeyCap
                key={code}
                keycode={code}
                active={heldKeys.includes(code)}
              />
            ))
          ) : (
            <span className="text-[13px] text-muted-foreground/70">
              {t("onboarding.shortcut.noShortcut")}
            </span>
          )}
        </div>
        <Verdict>{t("onboarding.shortcut.caption")}</Verdict>
        <CardActions>
          <ObButton variant="soft" onClick={() => setModalOpen(true)}>
            {t("onboarding.shortcut.changeHotkey")}
          </ObButton>
          <ObButton onClick={onNext}>
            {t("onboarding.navigation.continue")}
            <ArrowRight size={16} />
          </ObButton>
        </CardActions>
      </PreviewPanel>

      <ChangeModal
        open={modalOpen}
        onOpenChange={handleModalOpenChange}
        title={t("onboarding.shortcut.changeHotkey")}
      >
        <OnboardingShortcutInput />
      </ChangeModal>
    </SplitScreen>
  );
}
