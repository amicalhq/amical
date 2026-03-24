/**
 * Telemetry Event Type Definitions
 *
 * Each event tracked in the application should have a corresponding interface here.
 * These interfaces ensure type safety when calling telemetry methods.
 *
 * Naming conventions:
 * - Event names: snake_case with domain prefix (e.g., onboarding_started)
 * - Properties: snake_case for consistency
 */

import { z } from "zod";
import { ErrorCodes, type ErrorCode } from "./error";
import type { WidgetNotificationType } from "./widget-notification";

// ============================================================================
// Onboarding Events
// ============================================================================

/**
 * Fired when user begins onboarding flow
 */
export interface OnboardingStartedEvent {
  platform: string;
  resumed: boolean;
  resumedFrom?: string;
}

/**
 * Fired when user views an onboarding screen
 */
export interface OnboardingScreenViewedEvent {
  screen: string;
  index: number;
  total: number;
}

/**
 * Fired when user selects feature interests
 */
export interface OnboardingFeaturesSelectedEvent {
  features: string[];
  count: number;
}

/**
 * Fired when user selects how they discovered the app
 */
export interface OnboardingDiscoverySelectedEvent {
  source: string;
  details?: string;
}

/**
 * Fired when user selects their preferred model type
 */
export interface OnboardingModelSelectedEvent {
  model_type: string;
  recommendation_followed: boolean;
}

/**
 * Fired when user completes the onboarding flow
 */
export interface OnboardingCompletedEvent {
  version: number;
  features_selected: string[];
  discovery_source?: string;
  model_type: string;
  recommendation_followed: boolean;
  skipped_screens?: string[];
}

/**
 * Fired when user abandons the onboarding flow
 */
export interface OnboardingAbandonedEvent {
  last_screen: string;
  timestamp: string;
}

// ============================================================================
// Native Helper Events
// ============================================================================

/**
 * Fired when the native helper process crashes
 */
export interface NativeHelperCrashedEvent {
  helper_name: string;
  platform: string;
  exit_code: number | null;
  signal: string | null;
  restart_attempt: number;
  max_restarts: number;
  will_restart: boolean;
}

// ============================================================================
// Notes Events
// ============================================================================

/**
 * Fired when a new note is created
 */
export interface NoteCreatedEvent {
  note_id: number;
  has_initial_content: boolean;
  has_icon: boolean;
}

// ============================================================================
// Transcription Events
// ============================================================================

/**
 * Fired when a user reports a transcription from history
 */
export interface TranscriptionReportedEvent {
  transcription_id: number;
  feedback_text: string;
  feedback_length: number;
  speech_model?: string;
  formatting_model?: string;
  language?: string;
  report_channel: "history";
}

// ============================================================================
// Widget Notification Events
// ============================================================================

/**
 * Fired when a widget notification/toast is shown to the user
 */
export const widgetNotificationShownSchema = z.object({
  notification_type: z.enum<
    WidgetNotificationType,
    [WidgetNotificationType, ...WidgetNotificationType[]]
  >([
    "no_audio",
    "empty_transcript",
    "transcription_failed",
    "recording_duration_warning",
    "recording_auto_stopped",
  ]),
  error_code: z
    .enum<
      ErrorCode,
      [ErrorCode, ...ErrorCode[]]
    >(Object.values(ErrorCodes) as [ErrorCode, ...ErrorCode[]])
    .optional(),
  trace_id: z.string().optional(),
});

export type WidgetNotificationShownEvent = z.infer<
  typeof widgetNotificationShownSchema
>;
