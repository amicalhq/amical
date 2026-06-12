import { useTranslation } from "react-i18next";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { resolveActiveMicrophone } from "@/utils/audio-devices";

/**
 * The microphone the app will actually record with: the highest-ranked entry
 * of the stored priority chain that's currently connected, plus its
 * user-facing label (falling back to the system-default wording). Single home
 * for the chain→active-mic derivation used by settings and onboarding.
 */
export function useActiveMicrophone(): {
  activeDeviceId: string;
  label: string;
  /** False until the priority chain and device list have both loaded —
   *  before that, activeDeviceId/label are provisional ("default" + fallback
   *  wording) and will swap once the queries resolve. */
  ready: boolean;
} {
  const { t } = useTranslation();
  const { data: settings } = api.settings.getSettings.useQuery();
  const { devices } = useAudioDevices();
  const ready = settings !== undefined && devices.length > 0;

  const activeDeviceId = resolveActiveMicrophone(
    settings?.recording?.microphonePriority,
    devices,
  );
  const label =
    devices.find((device) => device.deviceId === activeDeviceId)?.label ??
    t("settings.dictation.microphone.systemDefault");

  return { activeDeviceId, label, ready };
}
