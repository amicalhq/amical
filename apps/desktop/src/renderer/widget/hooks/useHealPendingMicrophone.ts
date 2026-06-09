import { useEffect } from "react";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { healPendingMicrophone } from "@/utils/audio-devices";

/**
 * TEMPORARY (remove a couple releases after the priority-chain release): completes
 * the v13 migration for users whose old name-only microphone preference couldn't
 * be resolved to a deviceId at migration time (the migration runs in the main
 * process, with no device access) and was stashed as `recording.pendingMicrophoneName`.
 * Mounted in the always-on widget renderer, this matches the pending name to a
 * connected device, writes a real id-set entry into `microphonePriority`, and
 * clears the pending value — keeping the chain always id-set.
 *
 * To delete once the name-only population has aged out: this hook, its mount in
 * widget/index.tsx, `pendingMicrophoneName` (schema), the pending-clear line in
 * `setMicrophonePriority`, `healPendingMicrophone`, and v13's name-only branch.
 */
export function useHealPendingMicrophone() {
  const { data: settings } = api.settings.getSettings.useQuery();
  const { mutate: setMicrophonePriority } =
    api.settings.setMicrophonePriority.useMutation();
  const priority = settings?.recording?.microphonePriority;
  const pendingName = settings?.recording?.pendingMicrophoneName;
  // Only enumerate devices when there's actually a pending value to heal, so the
  // (overwhelming) majority of users with none pay no getUserMedia/enumerate cost.
  const { devices } = useAudioDevices(!!pendingName);

  useEffect(() => {
    if (!pendingName || devices.length === 0) return;
    const next = healPendingMicrophone(priority ?? [], pendingName, devices);
    // `setMicrophonePriority` clears the pending value, so this resolves once and
    // then the guard above stops it from re-running.
    if (next) setMicrophonePriority({ priority: next });
  }, [pendingName, priority, devices, setMicrophonePriority]);
}
