import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import {
  WIDGET_NOTIFICATION_TIMEOUT,
  WIDGET_NOTIFICATION_CONFIG,
  type WidgetNotificationAction,
  type WidgetNotification,
} from "@/types/widget-notification";
import type { RecordingState } from "@/types/recording";
import { WidgetToast } from "../components/WidgetToast";
import { setPassThroughReason } from "../pass-through";

export const useWidgetNotifications = (recordingState: RecordingState) => {
  const navigateMainWindow = api.widget.navigateMainWindow.useMutation();
  const trackEvent = api.telemetry.trackEvent.useMutation();
  const activeToastIdsRef = useRef<Set<string | number>>(new Set());
  const prevRecordingStateRef = useRef<RecordingState>(recordingState);

  const syncToastPassThrough = () => {
    setPassThroughReason("toast", activeToastIdsRef.current.size > 0);
  };

  const handleActionClick = async (action: WidgetNotificationAction) => {
    if (action.navigateTo) {
      navigateMainWindow.mutate({ route: action.navigateTo });
    } else if (action.externalUrl) {
      await window.electronAPI.openExternal(action.externalUrl);
    }
  };

  const showNotificationToast = (
    notification: Pick<
      WidgetNotification,
      | "type"
      | "title"
      | "description"
      | "subDescription"
      | "traceId"
      | "primaryAction"
      | "secondaryAction"
    >,
    duration = WIDGET_NOTIFICATION_TIMEOUT,
  ) => {
    const description =
      notification.description ??
      WIDGET_NOTIFICATION_CONFIG[notification.type].description;

    // Same cleanup whether the toast is dismissed or auto-closes.
    const handleToastClosed = () => {
      activeToastIdsRef.current.delete(createdToastId);
      syncToastPassThrough();
    };
    const createdToastId = toast.custom(
      (toastId) => (
        <WidgetToast
          title={notification.title}
          description={description}
          isError={true}
          subDescription={notification.subDescription}
          traceId={notification.traceId}
          primaryAction={notification.primaryAction}
          secondaryAction={notification.secondaryAction}
          onActionClick={(action) => {
            handleActionClick(action);
            toast.dismiss(toastId);
          }}
          onDismiss={() => toast.dismiss(toastId)}
        />
      ),
      {
        unstyled: true,
        duration,
        onDismiss: handleToastClosed,
        onAutoClose: handleToastClosed,
      },
    );
    activeToastIdsRef.current.add(createdToastId);
    syncToastPassThrough();
  };

  useEffect(() => {
    return () => {
      activeToastIdsRef.current.clear();
      setPassThroughReason("toast", false);
    };
  }, []);

  // Clear any lingering notification toasts the moment a new recording begins.
  // Toasts live for WIDGET_NOTIFICATION_TIMEOUT (7s), so without this a "No
  // speech detected" (or other error) toast from the previous session stays on
  // screen and bleeds into the next press — making it look like the new
  // recording instantly failed before its own finalize could run. Trigger on
  // entering any active state (not just "starting"): idle→starting→recording
  // can land in a single render, so "starting" alone may never be observed.
  useEffect(() => {
    const isActive = (s: RecordingState) =>
      s === "starting" || s === "recording";
    const prev = prevRecordingStateRef.current;
    prevRecordingStateRef.current = recordingState;
    // Only act on the idle→active edge, and only when there's actually
    // something to clear. We clear just the "toast" pass-through reason — never
    // the whole widget — so dismissing a stale toast can't make the window
    // click-through while the FAB is hovered or a draft review is open.
    if (
      isActive(recordingState) &&
      !isActive(prev) &&
      activeToastIdsRef.current.size > 0
    ) {
      activeToastIdsRef.current.forEach((id) => toast.dismiss(id));
      activeToastIdsRef.current.clear();
      setPassThroughReason("toast", false);
    }
  }, [recordingState]);

  api.recording.widgetNotifications.useSubscription(undefined, {
    onData: (notification) => {
      showNotificationToast(notification);
      trackEvent.mutate({
        event: "widget_notification_shown",
        payload: {
          notification_type: notification.type,
          error_code: notification.errorCode,
          trace_id: notification.traceId,
        },
      });
    },
    onError: (error) => {
      console.error("Widget notification subscription error:", error);
    },
  });
};
