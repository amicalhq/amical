import { toast } from "sonner";
import { api } from "@/trpc/react";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import {
  WIDGET_NOTIFICATION_TIMEOUT,
  getNotificationDescription,
  type WidgetNotificationAction,
} from "@/types/widget-notification";
import { WidgetToast } from "../components/WidgetToast";
import { useTranslation } from "react-i18next";

export const useWidgetNotifications = () => {
  const { t } = useTranslation();
  const navigateMainWindow = api.widget.navigateMainWindow.useMutation();
  const setIgnoreMouseEvents = api.widget.setIgnoreMouseEvents.useMutation();
  const { data: settings } = api.settings.getSettings.useQuery();
  const { defaultDeviceName } = useAudioDevices();

  // Get effective mic name: preferred from settings, or system default
  const getEffectiveMicName = () => {
    return settings?.recording?.preferredMicrophoneName || defaultDeviceName;
  };

  const reEnablePassThrough = () => {
    setTimeout(() => {
      setIgnoreMouseEvents.mutate({ ignore: true });
    }, 100);
  };

  const handleActionClick = async (action: WidgetNotificationAction) => {
    if (action.navigateTo) {
      navigateMainWindow.mutate({ route: action.navigateTo });
    } else if (action.externalUrl) {
      await window.electronAPI.openExternal(action.externalUrl);
    }
    reEnablePassThrough();
  };

  api.recording.widgetNotifications.useSubscription(undefined, {
    onData: (notification) => {
      // Use provided description, or generate with mic name for audio-related notifications
      const micName =
        getEffectiveMicName() || t("widget.notifications.micFallback");
      const description =
        notification.description ||
        getNotificationDescription(notification.type, micName);

      toast.custom(
        (toastId) => (
          <WidgetToast
            title={notification.title}
            description={description}
            isError={true}
            showRecordingSaved={
              notification.type === "transcription_failed" ||
              notification.type === "empty_transcript"
            }
            traceId={notification.traceId}
            primaryAction={notification.primaryAction}
            secondaryAction={notification.secondaryAction}
            onActionClick={(action) => {
              handleActionClick(action);
              toast.dismiss(toastId);
            }}
          />
        ),
        {
          unstyled: true,
          duration: WIDGET_NOTIFICATION_TIMEOUT,
          onDismiss: reEnablePassThrough,
          onAutoClose: reEnablePassThrough,
        },
      );
    },
    onError: (error) => {
      console.error("Widget notification subscription error:", error);
    },
  });
};
