import { ErrorCodes, type ErrorCode } from "./error";

export type WidgetNotificationType =
  | "no_audio"
  | "empty_transcript"
  | "transcription_failed";

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
  description?: string; // Pre-filled description, or generated via template on frontend
  errorCode?: ErrorCode; // For transcription_failed
  traceId?: string; // For cloud debugging
  primaryAction?: WidgetNotificationAction;
  secondaryAction?: WidgetNotificationAction;
  timestamp: number;
}

// Fallback template function to generate description with mic name (used on frontend when description not provided)
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
    case "transcription_failed":
      return "An error occurred during transcription";
  }
};

// Discord support server URL (same as sidebar Community link)
export const DISCORD_SUPPORT_URL = "https://amical.ai/community";

// Config keyed directly by error code
export const ERROR_CODE_CONFIG: Record<ErrorCode, WidgetNotificationConfig> = {
  [ErrorCodes.AUTH_REQUIRED]: {
    title: "Login required",
    description: "Please log in to use cloud transcription",
    primaryAction: { label: "Log In", navigateTo: "/settings/account" },
    secondaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.RATE_LIMIT_EXCEEDED]: {
    title: "Rate limit exceeded",
    description: "You've reached your transcription limit",
    primaryAction: { label: "View Usage", navigateTo: "/settings/account" },
    secondaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.INTERNAL_SERVER_ERROR]: {
    title: "Server error",
    description: "Please try again later",
    primaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
    secondaryAction: { label: "View History", navigateTo: "/history" },
  },
  [ErrorCodes.UNKNOWN]: {
    title: "Transcription failed",
    description: "Something went wrong",
    primaryAction: { label: "View History", navigateTo: "/history" },
    secondaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.NETWORK_ERROR]: {
    title: "Connection error",
    description: "Check your internet connection",
    primaryAction: { label: "Settings", navigateTo: "/settings" },
    secondaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.MODEL_MISSING]: {
    title: "No model available",
    description: "Download a local model or switch to cloud",
    primaryAction: { label: "AI Models", navigateTo: "/settings/ai-models" },
    secondaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.WORKER_INITIALIZATION_FAILED]: {
    title: "Initialization failed",
    description: "Failed to start transcription engine",
    primaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.WORKER_CRASHED]: {
    title: "Transcription engine crashed",
    description: "Please try again",
    primaryAction: {
      label: "Support",
      icon: "discord",
      externalUrl: DISCORD_SUPPORT_URL,
    },
  },
  [ErrorCodes.LOCAL_TRANSCRIPTION_FAILED]: {
    title: "Local transcription failed",
    description: "Whisper audio processing failed",
    primaryAction: { label: "View History", navigateTo: "/history" },
    secondaryAction: {
      label: "Support",
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
  // Placeholder for type checking - actual config comes from ERROR_CODE_CONFIG
  transcription_failed: ERROR_CODE_CONFIG[ErrorCodes.UNKNOWN],
};

export const WIDGET_NOTIFICATION_TIMEOUT = 5000;
