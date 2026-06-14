import type { AppContext } from "@amical/types";

/**
 * Application type used to pick formatting rules for a dictation. Kept in sync
 * with the Axis backend (~/exa9/axis), packages/prompts/src/formatting.ts.
 */
export type AppType = "email" | "chat" | "notes" | "amical-notes" | "default";

/**
 * App-side augmentation of the native accessibility context. `appTypeOverride`
 * is NEVER emitted by the native helper — the app stamps it to force the
 * app-type for its OWN windows (e.g. the onboarding try-it surfaces) where the
 * helper can't report a usable window title (notably on Windows, where our own
 * Electron window yields a null windowInfo). It is optional, so a value typed as
 * the plain wire type is still assignable here and vice versa.
 */
export type AppContextWithOverride = AppContext & { appTypeOverride?: AppType };

export type AccessibilityContextWithOverride = {
  context: AppContextWithOverride | null;
};

/** The onboarding try-it demo surfaces — the app-types their live demos depict. */
export type TryItSurface = Extract<AppType, "email" | "notes">;
