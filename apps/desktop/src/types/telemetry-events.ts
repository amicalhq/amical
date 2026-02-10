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
 * Fired when user selects how they discovered the app
 */
export interface OnboardingDiscoverySelectedEvent {
  source: string;
  details?: string;
}

/**
 * Fired when user completes the onboarding flow
 */
export interface OnboardingCompletedEvent {
  version: number;
  discovery_source?: string;
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
