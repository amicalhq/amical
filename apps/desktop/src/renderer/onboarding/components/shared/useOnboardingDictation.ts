import { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import type { RecordingState } from "@/types/recording";

/**
 * Drives a dictation try-it step. Marks the step active — which lifts the
 * onboarding shortcut suppression and brings up the real recording widget —
 * then only OBSERVES recording state for the coach bubble. The session is the
 * full production flow: the widget window captures audio and the transcript is
 * pasted into this window's focused text field; nothing comes back over IPC.
 */
export function useOnboardingDictation(): { isRecording: boolean } {
  const [state, setState] = useState<RecordingState>("idle");
  // react-query's `mutate` is referentially stable, so the effect runs once.
  const { mutate: setTryIt } = api.onboarding.setDictationTryIt.useMutation();

  // Active for the lifetime of this hook (one try-it step).
  useEffect(() => {
    setTryIt({ active: true });
    return () => setTryIt({ active: false });
  }, [setTryIt]);

  api.recording.stateUpdates.useSubscription(undefined, {
    onData: (update) => setState(update.state),
  });

  return { isRecording: state === "recording" };
}
