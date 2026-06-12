import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Lightbulb, Mic } from "lucide-react";
import {
  SplitScreen,
  PreviewPanel,
  Verdict,
  CardActions,
} from "../shared/SplitScreen";
import { NavigationButtons } from "../shared/NavigationButtons";
import { ObButton } from "../shared/ui";
import { MicLevelBar } from "../shared/MicLevelBar";
import { MicrophoneDialog } from "@/renderer/main/pages/settings/dictation/components/MicrophoneDialog";
import { useMicLevel } from "@/hooks/useMicLevel";
import { useActiveMicrophone } from "@/hooks/useActiveMicrophone";
import { OnboardingScreen } from "../../../../types/onboarding";

interface MicTestScreenProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * The live instrument: meter + caption. Isolated so the per-frame level updates
 * from useMicLevel re-render only this leaf, not the whole screen.
 */
function MicMeter({
  deviceId,
  enabled,
}: {
  deviceId: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const level = useMicLevel(deviceId, enabled);

  return (
    <>
      <MicLevelBar level={level} />
      <Verdict>{t("onboarding.micTest.caption")}</Verdict>
    </>
  );
}

/**
 * "Test your microphone" — a live input-level meter the user verifies by eye
 * (no heard-gate). The change action (labelled with the active mic, per the
 * mock's `micVal`) opens the real settings MicrophoneDialog.
 */
export function MicTestScreen({ onNext, onBack }: MicTestScreenProps) {
  const { t } = useTranslation();
  const { activeDeviceId, label: activeLabel, ready } = useActiveMicrophone();
  const [micModalOpen, setMicModalOpen] = useState(false);

  return (
    <SplitScreen
      screen={OnboardingScreen.MicTest}
      title={t("onboarding.micTest.title")}
      subtitle={t("onboarding.micTest.subtitle")}
      hint={
        <>
          <Lightbulb size={15} />
          <span>{t("onboarding.micTest.hint")}</span>
        </>
      }
      footer={<NavigationButtons onBack={onBack} showNext={false} />}
    >
      <PreviewPanel>
        {/* Suspend until the active mic is resolved — starting on the
            provisional "default" id would tear down and reopen the stream
            (bars flash dark) when the priority chain loads a moment later —
            and while the dialog is open, since it meters the same device with
            its own stream (two live streams on one mic are wasteful). */}
        <MicMeter deviceId={activeDeviceId} enabled={ready && !micModalOpen} />
        <CardActions>
          <ObButton
            variant="soft"
            onClick={() => setMicModalOpen(true)}
            title={t("onboarding.micTest.change")}
          >
            <Mic size={16} />
            <span className="max-w-[220px] truncate">{activeLabel}</span>
          </ObButton>
          <ObButton onClick={onNext}>
            {t("onboarding.navigation.continue")}
            <ArrowRight size={16} />
          </ObButton>
        </CardActions>
      </PreviewPanel>

      {/* Mounted only while open: the dialog's hooks enumerate devices and open
          a metering stream even when the dialog itself is closed. */}
      {micModalOpen && <MicrophoneDialog open onOpenChange={setMicModalOpen} />}
    </SplitScreen>
  );
}
