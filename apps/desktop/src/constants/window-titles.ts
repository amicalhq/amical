/**
 * Title of the onboarding window (set in onboarding.html). detectApplicationType
 * (formatter-prompt.ts) matches it to treat the setup wizard as a generic
 * surface. The try-it demo surfaces are signalled separately via
 * AppContextWithOverride — the helper can't read our own window's title on
 * Windows. Constant, never localized copy.
 */
export const ONBOARDING_WINDOW_TITLE = "Amical - Setup";
