import { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import type { RecordingState } from "@/types/recording";
import type { TryItSurface } from "@/types/app-type";

/**
 * Drives a dictation try-it step. Marks the step active — which lifts the
 * onboarding shortcut suppression and brings up the real recording widget —
 * then only OBSERVES recording state for the coach bubble. The session is the
 * full production flow: the widget window captures audio and the transcript is
 * pasted into this window's focused text field; nothing comes back over IPC.
 */
export function useOnboardingDictation(surface?: TryItSurface): {
  isRecording: boolean;
} {
  const [state, setState] = useState<RecordingState>("idle");
  // react-query's `mutate` is referentially stable, so the effect runs once.
  const { mutate: setTryIt } = api.onboarding.setDictationTryIt.useMutation();

  // Active for the lifetime of this hook (one try-it step). The surface tells
  // the main process which emulated app this demo depicts, so dictation formats
  // accordingly — see setDictationTryIt / detectApplicationType.
  useEffect(() => {
    setTryIt({ active: true, surface });
    return () => setTryIt({ active: false });
  }, [setTryIt, surface]);

  api.recording.stateUpdates.useSubscription(undefined, {
    onData: (update) => setState(update.state),
  });

  return { isRecording: state === "recording" };
}
