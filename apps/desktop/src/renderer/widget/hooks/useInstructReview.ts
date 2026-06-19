import { useEffect, useState } from "react";
import { api } from "@/trpc/react";

export interface InstructReviewState {
  /** The generated text to review, or null when there's nothing to review. */
  review: { sessionId: string; text: string } | null;
  /** Paste the reviewed text into the target app and close. */
  paste: () => Promise<void>;
  /** Discard the reviewed text and close. */
  dismiss: () => Promise<void>;
}

export function useInstructReview(): InstructReviewState {
  const [review, setReview] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);

  // Toggles the widget window's mouse passthrough
  // (ignore: true = click-through; ignore: false = clickable).
  const setMousePassthrough = api.widget.setIgnoreMouseEvents.useMutation();
  const confirmInstruct = api.recording.confirmInstruct.useMutation();
  const dismissInstruct = api.recording.dismissInstruct.useMutation();

  api.recording.instructReview.useSubscription(undefined, {
    onData: (data) => setReview(data),
    onError: (error) =>
      console.error("instructReview subscription error", error),
  });

  // While reviewing, the widget must be clickable (its default is mouse
  // pass-through). Disable pass-through when a review appears.
  useEffect(() => {
    if (review) {
      setMousePassthrough.mutate({ ignore: false });
    }
    // setMousePassthrough is a stable tRPC mutation handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);

  const close = () => {
    setMousePassthrough.mutate({ ignore: true });
    setReview(null);
  };

  const paste = async () => {
    try {
      await confirmInstruct.mutateAsync();
    } finally {
      close();
    }
  };

  const dismiss = async () => {
    try {
      await dismissInstruct.mutateAsync();
    } finally {
      close();
    }
  };

  return { review, paste, dismiss };
}
