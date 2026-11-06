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

import type { EditWatchStartStatus } from "@amical/types";
import { z } from "zod";
import type { EditMetrics } from "../services/vocabulary-learning/edit-metrics";
import type {
  EditFinalState,
  EditTrackerEndReason,
} from "../services/vocabulary-learning/types";
import { ErrorCodes, type DictationErrorCode, type ErrorCode } from "./error";

// ============================================================================
// Onboarding Events
// ============================================================================

/**
 * Fired when user begins onboarding flow
 */
export interface OnboardingStartedEvent {
  resumed: boolean;
  resumedFrom?: string;
}

/**
 * Fired when user views an onboarding screen
 */
export interface OnboardingScreenViewedEvent {
  screen: string;
}

/**
 * Fired when an onboarding step with an optional action is exited forward —
 * records whether the user actually did the thing (e.g. dictated in a try-it)
 * or moved past it without doing it.
 */
export interface OnboardingStepResultEvent {
  screen: string;
  outcome: "completed" | "skipped";
}

/**
 * Fired when user selects feature interests
 */
export interface OnboardingFeaturesSelectedEvent {
  features: string[];
  count: number;
  details?: string;
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
  note_id: string;
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

export type CloudFallbackStage = "transcribe" | "flush";

/**
 * Fired when a cloud-transcription gRPC stream fails and the provider
 * engages the HTTP fallback. The fallback is cleared on the next session,
 * so a single event covers exactly one dropped stream.
 */
export interface CloudGrpcFallbackEvent {
  error_code: ErrorCode;
  application_code?: DictationErrorCode;
  grpc_status?: number;
  http_status?: number;
  message: string;
  trace_id?: string;
  session_id?: string;
  fallback_stage: CloudFallbackStage;
}

// ============================================================================
// Widget Notification Events
// ============================================================================

/**
 * Fired when a widget notification/toast is shown to the user
 */
export const widgetNotificationShownSchema = z.object({
  notification_type: z.enum([
    "no_audio",
    "empty_transcript",
    "transcription_failed",
    "recording_duration_warning",
    "recording_auto_stopped",
    "vocabulary_learned",
  ]),
  error_code: z
    .enum(Object.values(ErrorCodes) as [ErrorCode, ...ErrorCode[]])
    .optional(),
  trace_id: z.string().optional(),
});

export type WidgetNotificationShownEvent = z.infer<
  typeof widgetNotificationShownSchema
>;

export const starNudgeSchema = z.object({
  outcome: z.enum(["shown", "clicked", "dismissed"]),
});

export type StarNudgeEvent = z.infer<typeof starNudgeSchema>;

// ============================================================================
// Edit Watch and Vocabulary Learning Events
// ============================================================================

export type EditWatchStartOutcome = EditWatchStartStatus | "error";

export type EditWatchEndReason =
  | EditTrackerEndReason
  | "start_refused"
  | "no_row"
  | "not_started";

export type VocabularyClassifierOutcome =
  | "ok"
  | "disabled"
  | "timeout"
  | "http_error"
  | "invalid";

/**
 * Fired once per edit watch attempt (a confirmed session paste that passed
 * the gate). Joins transcription_completed_v2 by session_id; provider and
 * model_id use the same keys and values. Counts and enums only: never words
 * or field text.
 */
export interface TranscriptionEditWatchCompletedEvent
  extends Partial<EditMetrics> {
  session_id: string;
  /** Absent when no start was attempted. */
  start_status?: EditWatchStartOutcome;
  end_reason: EditWatchEndReason;
  /** The app type saved with the dictation; absent without a row. */
  app_type?: string;
  provider?: string;
  model_id?: string;
  formatting_model?: string;
  language?: string;
  detected_language?: string;
  /** Set when the watch started. */
  final_state?: EditFinalState;
  key_events_seen?: boolean;
  stable_final_state?: boolean;
  /** Watch start to the read that located the paste; absent if never located. */
  locate_duration_ms?: number;
  read_count?: number;
  read_error_count?: number;
  read_duration_max_ms?: number;
  /** Raw text compare (watch health). For analysis use change_kind. */
  changed?: boolean;
  watch_duration_ms?: number;
  reanchor_count?: number;
  rearranged_count?: number;
  paste_reset_count?: number;
  enter_mark_dropped_count?: number;
}

/**
 * Fired each time auto vocabulary runs on a watch's final version, also when
 * nothing is learned. Joins transcription_edit_watch_completed by session_id.
 * Counts and enums only: never terms or field text.
 */
export interface VocabularyLearningCompletedEvent {
  session_id: string;
  /** The user rewrote the text: no candidates are taken from it. */
  rewrite?: boolean;
  candidate_count?: number;
  drop_shape_count?: number;
  drop_length_count?: number;
  drop_known_count?: number;
  drop_cjk_count?: number;
  drop_duplicate_count?: number;
  drop_cap_count?: number;
  sent_count?: number;
  accepted_count?: number;
  added_count?: number;
  multiword_count?: number;
  classifier_outcome?: VocabularyClassifierOutcome;
  classifier_duration_ms?: number;
}

/**
 * Fired when learned words are removed: from the toast's Undo or by deleting
 * a learned row in Settings.
 */
export interface VocabularyAutoUndoneEvent {
  count: number;
  via: "toast" | "settings";
  age_ms: number;
}
