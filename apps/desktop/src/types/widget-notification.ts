export type WidgetNotificationType = "no_audio" | "empty_transcript";

export type WidgetNotificationActionIcon = "discord";

export interface WidgetNotificationAction {
  label: string;
  icon?: WidgetNotificationActionIcon;
  navigateTo?: string; // Route to navigate to in main window
  externalUrl?: string; // External URL to open
}

export interface WidgetNotificationConfig {
  title: string;
  description: string;
  primaryAction?: WidgetNotificationAction;
  secondaryAction?: WidgetNotificationAction;
}

export interface WidgetNotification {
  id: string;
  type: WidgetNotificationType;
  title: string;
  primaryAction?: WidgetNotificationAction;
  secondaryAction?: WidgetNotificationAction;
  timestamp: number;
}

// Template function to generate description with mic name (used on frontend)
export const getNotificationDescription = (
  type: WidgetNotificationType,
  microphoneName?: string,
): string => {
  const micDisplay = microphoneName || "your microphone";
  switch (type) {
    case "no_audio":
      return `No audio from "${micDisplay}"`;
    case "empty_transcript":
      return `No speech detected from "${micDisplay}"`;
  }
};

// Discord support server URL (same as sidebar Community link)
export const DISCORD_SUPPORT_URL = "https://amical.ai/community";

export const WIDGET_NOTIFICATION_CONFIG: Record<
  WidgetNotificationType,
  WidgetNotificationConfig
> = {
  no_audio: {
    title: "No audio detected",
    description: "Check your microphone settings", // Fallback, replaced by template
    primaryAction: {
      label: "Configure Microphone",
      navigateTo: "/settings/dictation",
    },
    secondaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  empty_transcript: {
    title: "No speech detected",
    description: "Try speaking louder or closer to the mic", // Fallback, replaced by template
    primaryAction: {
      label: "Configure Microphone",
      navigateTo: "/settings/dictation",
    },
    secondaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
};

export const WIDGET_NOTIFICATION_TIMEOUT = 5000;
