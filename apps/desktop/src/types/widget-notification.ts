import { ErrorCodes, type ErrorCode } from "./error";

export type WidgetNotificationType =
  | "no_audio"
  | "empty_transcript"
  | "transcription_failed";

export type WidgetNotificationActionIcon = "discord";

export type I18nText = {
  key: string;
  params?: Record<string, string | number>;
};

export type LocalizedText = string | I18nText;

export interface WidgetNotificationAction {
  label: LocalizedText;
  icon?: WidgetNotificationActionIcon;
  navigateTo?: string; // Route to navigate to in main window
  externalUrl?: string; // External URL to open
}

export interface WidgetNotificationConfig {
  title: LocalizedText;
  description: LocalizedText;
  primaryAction?: WidgetNotificationAction;
  secondaryAction?: WidgetNotificationAction;
}

export interface WidgetNotification {
  id: string;
  type: WidgetNotificationType;
  title: LocalizedText;
  description?: LocalizedText; // Pre-filled description, or generated via template on frontend
  errorCode?: ErrorCode; // For transcription_failed
  traceId?: string; // For cloud debugging
  primaryAction?: WidgetNotificationAction;
  secondaryAction?: WidgetNotificationAction;
  timestamp: number;
}

// Fallback template function to generate description with mic name (used on frontend when description not provided)
export const getNotificationDescription = (
  type: WidgetNotificationType,
  microphoneName: string,
): I18nText => {
  switch (type) {
    case "no_audio":
      return {
        key: "widget.notifications.description.noAudio",
        params: { microphone: microphoneName },
      };
    case "empty_transcript":
      return {
        key: "widget.notifications.description.emptyTranscript",
        params: { microphone: microphoneName },
      };
    case "transcription_failed":
      return { key: "widget.notifications.description.transcriptionFailed" };
  }
};

// Discord support server URL (same as sidebar Community link)
export const DISCORD_SUPPORT_URL = "https://amical.ai/community";

// Config keyed directly by error code
export const ERROR_CODE_CONFIG: Record<ErrorCode, WidgetNotificationConfig> = {
  [ErrorCodes.AUTH_REQUIRED]: {
    title: { key: "widget.notifications.errorCode.authRequired.title" },
    description: {
      key: "widget.notifications.errorCode.authRequired.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.logIn" },
      navigateTo: "/settings/account",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.RATE_LIMIT_EXCEEDED]: {
    title: { key: "widget.notifications.errorCode.rateLimitExceeded.title" },
    description: {
      key: "widget.notifications.errorCode.rateLimitExceeded.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.viewUsage" },
      navigateTo: "/settings/account",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.INTERNAL_SERVER_ERROR]: {
    title: { key: "widget.notifications.errorCode.internalServerError.title" },
    description: {
      key: "widget.notifications.errorCode.internalServerError.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.viewHistory" },
      navigateTo: "/history",
    },
  },
  [ErrorCodes.UNKNOWN]: {
    title: { key: "widget.notifications.errorCode.unknown.title" },
    description: { key: "widget.notifications.errorCode.unknown.description" },
    primaryAction: {
      label: { key: "widget.notifications.action.viewHistory" },
      navigateTo: "/history",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.NETWORK_ERROR]: {
    title: { key: "widget.notifications.errorCode.networkError.title" },
    description: {
      key: "widget.notifications.errorCode.networkError.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.settings" },
      navigateTo: "/settings",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.MODEL_MISSING]: {
    title: { key: "widget.notifications.errorCode.modelMissing.title" },
    description: {
      key: "widget.notifications.errorCode.modelMissing.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.aiModels" },
      navigateTo: "/settings/ai-models",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.WORKER_INITIALIZATION_FAILED]: {
    title: {
      key: "widget.notifications.errorCode.workerInitializationFailed.title",
    },
    description: {
      key: "widget.notifications.errorCode.workerInitializationFailed.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.WORKER_CRASHED]: {
    title: { key: "widget.notifications.errorCode.workerCrashed.title" },
    description: {
      key: "widget.notifications.errorCode.workerCrashed.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.LOCAL_TRANSCRIPTION_FAILED]: {
    title: {
      key: "widget.notifications.errorCode.localTranscriptionFailed.title",
    },
    description: {
      key: "widget.notifications.errorCode.localTranscriptionFailed.description",
    },
    primaryAction: {
      label: { key: "widget.notifications.action.viewHistory" },
      navigateTo: "/history",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
};

export const WIDGET_NOTIFICATION_CONFIG: Record<
  WidgetNotificationType,
  WidgetNotificationConfig
> = {
  no_audio: {
    title: { key: "widget.notifications.type.noAudio.title" },
    description: { key: "widget.notifications.type.noAudio.description" }, // Fallback, replaced by template
    primaryAction: {
      label: { key: "widget.notifications.action.configureMicrophone" },
      navigateTo: "/settings/dictation",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  empty_transcript: {
    title: { key: "widget.notifications.type.emptyTranscript.title" },
    description: {
      key: "widget.notifications.type.emptyTranscript.description",
    }, // Fallback, replaced by template
    primaryAction: {
      label: { key: "widget.notifications.action.configureMicrophone" },
      navigateTo: "/settings/dictation",
    },
    secondaryAction: {
      label: { key: "widget.notifications.action.support" },
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  // Placeholder for type checking - actual config comes from ERROR_CODE_CONFIG
  transcription_failed: ERROR_CODE_CONFIG[ErrorCodes.UNKNOWN],
};

export const WIDGET_NOTIFICATION_TIMEOUT = 5000;
