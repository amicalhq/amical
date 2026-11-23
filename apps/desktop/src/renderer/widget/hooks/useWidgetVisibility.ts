import { useEffect, useRef, useState } from "react";
import { api } from "@/trpc/react";
import type { RecordingState } from "@/types/recording";

export const useWidgetVisibility = ({
  recordingState,
  hasPendingDraft,
  hasVisibleNotification,
  notificationSequence,
}: {
  recordingState: RecordingState;
  hasPendingDraft: boolean;
  hasVisibleNotification: boolean;
  notificationSequence: number;
}) => {
  const [showWhileInactive, setShowWhileInactive] = useState<boolean | null>(
    null,
  );
  const { mutate: setVisible } = api.widget.setVisible.useMutation();
  // Without global shortcuts (Linux for now) the widget is the only way to
  // start a dictation, so it stays visible whatever the preference says.
  const { data: shortcutSupport } = api.settings.getShortcutSupport.useQuery();
  const widgetIsTheOnlyStart = shortcutSupport?.available === false;

  api.settings.widgetVisibilityPreference.useSubscription(undefined, {
    onData: setShowWhileInactive,
    onError: (error) => {
      console.error("Widget visibility preference subscription error", error);
    },
  });

  const hasVisibleContent =
    recordingState !== "idle" || hasPendingDraft || hasVisibleNotification;
  const shouldShowWidget =
    showWhileInactive === true || widgetIsTheOnlyStart || hasVisibleContent;
  const hasActiveRecording =
    recordingState === "starting" || recordingState === "recording";

  // A new content reason must also reassert an already-visible Windows window's
  // z-order. Track only those edges so FSM progress does not generate extra IPC.
  const previousStateRef = useRef({
    initialized: false,
    shouldShowWidget,
    hasActiveRecording,
    hasPendingDraft,
    notificationSequence,
  });

  useEffect(() => {
    const previous = previousStateRef.current;
    const visibilityChanged =
      !previous.initialized || previous.shouldShowWidget !== shouldShowWidget;
    const contentNeedsReassertion =
      (!previous.hasActiveRecording && hasActiveRecording) ||
      (!previous.hasPendingDraft && hasPendingDraft) ||
      previous.notificationSequence !== notificationSequence;

    previousStateRef.current = {
      initialized: true,
      shouldShowWidget,
      hasActiveRecording,
      hasPendingDraft,
      notificationSequence,
    };

    if (!visibilityChanged && !contentNeedsReassertion) {
      return;
    }

    setVisible({
      visible: shouldShowWidget,
    });
  }, [
    hasActiveRecording,
    hasPendingDraft,
    notificationSequence,
    setVisible,
    shouldShowWidget,
  ]);
};
