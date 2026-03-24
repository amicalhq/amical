import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import {
  WIDGET_NOTIFICATION_TIMEOUT,
  getNotificationDescription,
  type WidgetNotificationAction,
  type WidgetNotification,
} from "@/types/widget-notification";
import { WidgetToast } from "../components/WidgetToast";
import { useTranslation } from "react-i18next";

const TOAST_INTERACTION_STATE_EVENT = "widget:toast-interaction-state";

export const useWidgetNotifications = () => {
  const { t } = useTranslation();
  const navigateMainWindow = api.widget.navigateMainWindow.useMutation();
  const setIgnoreMouseEvents = api.widget.setIgnoreMouseEvents.useMutation();
  const trackEvent = api.telemetry.trackEvent.useMutation();
  const { data: settings } = api.settings.getSettings.useQuery();
  const { defaultDeviceName } = useAudioDevices();
  const activeToastIdsRef = useRef<Set<string | number>>(new Set());

  // Get effective mic name: preferred from settings, or system default
  const getEffectiveMicName = () => {
    return settings?.recording?.preferredMicrophoneName || defaultDeviceName;
  };

  const syncPassThroughWithToastState = () => {
    const hasActiveToasts = activeToastIdsRef.current.size > 0;
    setIgnoreMouseEvents.mutate({ ignore: !hasActiveToasts });
    window.dispatchEvent(
      new CustomEvent<{ active: boolean }>(TOAST_INTERACTION_STATE_EVENT, {
        detail: { active: hasActiveToasts },
      }),
    );
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
    const micName =
      getEffectiveMicName() || t("widget.notifications.micFallback");
    const description =
      notification.description ||
      getNotificationDescription(notification.type, micName);

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
        onDismiss: () => {
          activeToastIdsRef.current.delete(createdToastId);
          syncPassThroughWithToastState();
        },
        onAutoClose: () => {
          activeToastIdsRef.current.delete(createdToastId);
          syncPassThroughWithToastState();
        },
      },
    );
    activeToastIdsRef.current.add(createdToastId);
    syncPassThroughWithToastState();
  };

  useEffect(() => {
    return () => {
      activeToastIdsRef.current.clear();
      setIgnoreMouseEvents.mutate({ ignore: true });
    };
  }, []);

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
