import { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import type { RecordingState } from "@/types/recording";

/**
 * Drives a dictation try-it step. Marks the step active — which lifts the
 * onboarding shortcut suppression and brings up the real recording widget —
 * then only OBSERVES recording state for the coach bubble. The session is the
 * full production flow: the widget window captures audio and the transcript is
 * pasted into this window's focused text field; nothing comes back over IPC.
 *
 * `isDraftTake` tags the current recording as a Draft take. It latches at the
 * first audio chunk (not at key-down), so it flips true a beat after
 * `isRecording` — the draft try-it screens use it to light their coach bubble
 * only for the Draft chord, not for plain push-to-talk.
 *
 * `isIdle` is false through the whole take, including the post-release
 * "stopping" phase while a draft generates — the insert cue keys off it so it
 * matches main's Enter arming (pendingDraft && idle) exactly.
 */
export function useOnboardingDictation(): {
  isRecording: boolean;
  isDraftTake: boolean;
  isIdle: boolean;
} {
  const [state, setState] = useState<RecordingState>("idle");
  const [isDraft, setIsDraft] = useState(false);
  // react-query's `mutate` is referentially stable, so the effect runs once.
  const { mutate: setTryIt } = api.onboarding.setDictationTryIt.useMutation();

  // Active for the lifetime of this hook (one try-it step).
  useEffect(() => {
    setTryIt({ active: true });
    return () => setTryIt({ active: false });
  }, [setTryIt]);

  api.recording.stateUpdates.useSubscription(undefined, {
    onData: (update) => {
      setState(update.state);
      setIsDraft(update.isDraft);
    },
  });

  return {
    isRecording: state === "recording",
    isDraftTake: isDraft,
    isIdle: state === "idle",
  };
}
