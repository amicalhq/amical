import { useState } from "react";
import { api } from "@/trpc/react";

export interface DraftReviewState {
  /** The generated text to review, or null when there's nothing to review. */
  review: { sessionId: string; text: string } | null;
  /** Insert the reviewed text into the target app and close. */
  insert: () => Promise<void>;
  /** Discard the reviewed text and close. */
  dismiss: () => Promise<void>;
}

export function useDraftReview(): DraftReviewState {
  const [review, setReview] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);

  // Toggles the widget window's mouse passthrough
  // (ignore: true = click-through; ignore: false = clickable).
  const setMousePassthrough = api.widget.setIgnoreMouseEvents.useMutation();
  const confirmDraft = api.recording.confirmDraft.useMutation();
  const dismissDraft = api.recording.dismissDraft.useMutation();

  // Single source of truth: the main process pushes the current draft, or null
  // when it's cleared by insert / dismiss / a new dictation. The widget must be
  // clickable while a draft is shown and pass-through (click-through) otherwise.
  api.recording.draftReview.useSubscription(undefined, {
    onData: (data) => {
      setReview(data);
      setMousePassthrough.mutate({ ignore: !data });
    },
    onError: (error) => console.error("draftReview subscription error", error),
  });

  const insert = async () => {
    await confirmDraft.mutateAsync();
  };

  const dismiss = async () => {
    await dismissDraft.mutateAsync();
  };

  return { review, insert, dismiss };
}
