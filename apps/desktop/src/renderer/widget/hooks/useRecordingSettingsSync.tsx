import { api } from "@/trpc/react";

/**
 * Refetches the widget's settings when recording settings (e.g. the preferred
 * microphone) change elsewhere, such as the Settings window. The widget runs in
 * a separate renderer with its own React Query cache, so it must invalidate
 * `getSettings` on these changes to avoid recording with a stale mic.
 */
export const useRecordingSettingsSync = () => {
  const utils = api.useUtils();

  api.settings.recordingSettingsUpdates.useSubscription(undefined, {
    onData: () => {
      // Invalidate rather than write the payload into the cache directly. The
      // widget's active observers refetch immediately (an in-process IPC round
      // trip), so the new value lands within milliseconds. There is a tiny
      // theoretical window where a recording started in that gap reads the old
      // mic, but the mic is changed in the Settings window while recording is
      // triggered from the widget/shortcut, so human latency dwarfs the
      // refetch and it is not observable in practice.
      void utils.settings.getSettings.invalidate();
    },
    onError: (error) => {
      console.error("Recording settings sync subscription error:", error);
    },
  });
};
