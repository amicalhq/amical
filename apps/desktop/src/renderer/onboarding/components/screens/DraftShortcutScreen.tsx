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
import { KeyCap, KeycapSentence, KEYS_SENTINEL } from "../shared/KeyCap";
import { useHeldKeys } from "../shared/useHeldKeys";
import { OnboardingShortcutInput } from "../shared/OnboardingShortcutInput";
import { OnboardingScreen } from "@/types/onboarding";
import { api } from "@/trpc/react";

interface DraftShortcutScreenProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * "Set your Draft shortcut" — the ShortcutScreen anatomy applied to the Draft
 * binding: its keycaps light up only while physically held, verified by eye.
 * The hint disambiguates it from the dictation shortcut (shown as inline
 * chips). "Change shortcut" opens the shared ChangeModal hosting the real
 * shortcut input pointed at the Draft binding.
 */
export function DraftShortcutScreen({
  onNext,
  onBack,
}: DraftShortcutScreenProps) {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const { data: shortcuts } = api.settings.getShortcuts.useQuery();
  const configured = shortcuts?.draftMode ?? [];
  const dictation = shortcuts?.pushToTalk ?? [];
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
      screen={OnboardingScreen.DraftShortcut}
      title={t("onboarding.draft.shortcut.title")}
      subtitle={t("onboarding.draft.shortcut.subtitle")}
      hint={
        <>
          <Keyboard size={15} />
          {/* display:inline (overriding the default inline-flex) so the long
              sentence wraps naturally in the rail; chips align via align-middle */}
          <KeycapSentence
            className="inline"
            sentence={t("onboarding.draft.shortcut.hint", {
              keys: KEYS_SENTINEL,
            })}
            codes={dictation}
            kbdClassName="mx-0.5 inline-flex rounded-[5px] border border-border bg-secondary px-1.5 py-0.5 align-middle font-mono text-[11px] font-semibold text-foreground"
          />
        </>
      }
      footer={<NavigationButtons showNext={false} showBack onBack={onBack} />}
    >
      <PreviewPanel>
        <div className="relative flex items-center justify-center gap-2.5">
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
        <Verdict>{t("onboarding.draft.shortcut.caption")}</Verdict>
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
        <OnboardingShortcutInput binding="draftMode" />
      </ChangeModal>
    </SplitScreen>
  );
}
