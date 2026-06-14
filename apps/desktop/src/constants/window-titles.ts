/**
 * Window titles double as the app-type signal for Amical's OWN dictation
 * surfaces: the native helper reads the focused window's AX title into the
 * accessibility context, and detectApplicationType (formatter-prompt.ts) maps
 * these exact values. Constants, never localized copy — the visible sheet
 * headers are separate i18n strings.
 */
export const ONBOARDING_WINDOW_TITLE = "Amical - Setup";

/** Set while a dictation try-it step is on screen, so the emulated surface
 *  formats like the app it depicts (email prose / notes list). */
export const TRY_IT_WINDOW_TITLES = {
  email: `${ONBOARDING_WINDOW_TITLE} - Email`,
  notes: `${ONBOARDING_WINDOW_TITLE} - Notes`,
} as const;
