import { OnboardingScreen, ModelType } from "../types/onboarding";
import type { OnboardingFeatureFlags } from "../types/onboarding";

/**
 * Canonical onboarding screen order.
 *
 * The setup step differs by branch (SignIn for cloud, Download for local) and
 * the try-it steps differ (formatting demo for cloud, verbatim for local).
 * Mic/Shortcut/Language are SHARED
 * across both branches (see getActiveOnboardingScreens).
 */
const BASE_ORDER: OnboardingScreen[] = [
  OnboardingScreen.Welcome,
  OnboardingScreen.DiscoverySource,
  OnboardingScreen.ModelSelection,
  OnboardingScreen.SignIn, // cloud-only setup
  OnboardingScreen.Download, // local-only setup
  // Permissions open the Configure phase: both grants are exercised seconds
  // later (mic -> meter, accessibility -> keycap/PTT), and asking after the
  // user has chosen + signed in beats interrupting the survey warm-up.
  OnboardingScreen.Permissions, // shared
  OnboardingScreen.MicTest, // shared
  OnboardingScreen.Shortcut, // shared
  OnboardingScreen.SpokenLanguage, // shared
  OnboardingScreen.DictationEmail, // cloud-only try-it
  OnboardingScreen.DictationNotes, // cloud-only try-it
  OnboardingScreen.DictationLocal, // local-only try-it (verbatim, no formatting demo)
  // Draft chapter: generation rides the cloud pipeline, so all four are
  // cloud-only. Ordered learn -> configure -> compose try-it -> selection
  // try-it, after the dictation try-its (draft builds on "you can dictate").
  OnboardingScreen.DraftIntro,
  OnboardingScreen.DraftShortcut,
  OnboardingScreen.DraftCompose,
  OnboardingScreen.DraftSelection,
  OnboardingScreen.Completion,
];

const CLOUD_ONLY = new Set<OnboardingScreen>([
  OnboardingScreen.SignIn,
  OnboardingScreen.DictationEmail,
  OnboardingScreen.DictationNotes,
  OnboardingScreen.DraftIntro,
  OnboardingScreen.DraftShortcut,
  OnboardingScreen.DraftCompose,
  OnboardingScreen.DraftSelection,
]);

const LOCAL_ONLY = new Set<OnboardingScreen>([
  OnboardingScreen.Download,
  OnboardingScreen.DictationLocal,
]);

/** Stable phase ids — display labels live under `onboarding.phases.*` in i18n. */
export type OnboardingPhase =
  | "getStarted"
  | "setUp"
  | "configure"
  | "tryIt"
  | "draft"
  | "done";

/** i18n key for a phase's display label (the eyebrow). */
export function phaseLabelKey(phase: OnboardingPhase): string {
  return `onboarding.phases.${phase}`;
}

/**
 * Phase ("chapter") each screen belongs to. Drives the segmented phase bar and
 * the eyebrow label.
 */
export const SCREEN_PHASE: Record<OnboardingScreen, OnboardingPhase> = {
  [OnboardingScreen.Welcome]: "getStarted",
  [OnboardingScreen.Permissions]: "configure",
  [OnboardingScreen.DiscoverySource]: "getStarted",
  [OnboardingScreen.ModelSelection]: "setUp",
  [OnboardingScreen.SignIn]: "setUp",
  [OnboardingScreen.Download]: "setUp",
  [OnboardingScreen.MicTest]: "configure",
  [OnboardingScreen.Shortcut]: "configure",
  [OnboardingScreen.SpokenLanguage]: "configure",
  [OnboardingScreen.DictationEmail]: "tryIt",
  [OnboardingScreen.DictationNotes]: "tryIt",
  [OnboardingScreen.DictationLocal]: "tryIt",
  [OnboardingScreen.DraftIntro]: "draft",
  [OnboardingScreen.DraftShortcut]: "draft",
  [OnboardingScreen.DraftCompose]: "draft",
  [OnboardingScreen.DraftSelection]: "draft",
  [OnboardingScreen.Completion]: "done",
};

/**
 * Ordered phase list for a set of active screens (drives the number/order of
 * phase segments). Derived so the rail always matches the screens actually
 * shown — a screen list with an entire phase skipped gets no empty segment.
 */
export function phasesForScreens(
  screens: OnboardingScreen[],
): OnboardingPhase[] {
  return [...new Set(screens.map((screen) => SCREEN_PHASE[screen]))];
}

/**
 * Compute the active onboarding screens for the current model selection,
 * feature flags, and explicitly-skipped screens. The cloud setup (SignIn) and
 * try-it steps appear only for cloud; the local setup (Download) appears only
 * for local; Mic/Shortcut/Language are shared.
 */
export function getActiveOnboardingScreens(opts: {
  modelType: ModelType | undefined;
  flags: OnboardingFeatureFlags | undefined;
  skipped: OnboardingScreen[];
}): OnboardingScreen[] {
  const skipped = new Set(opts.skipped);
  const isCloud = opts.modelType === ModelType.Cloud;
  const isLocal = opts.modelType === ModelType.Local;

  return BASE_ORDER.filter((screen) => {
    if (skipped.has(screen)) return false;
    if (CLOUD_ONLY.has(screen) && !isCloud) return false;
    if (LOCAL_ONLY.has(screen) && !isLocal) return false;

    if (opts.flags) {
      if (screen === OnboardingScreen.Welcome && opts.flags.skipWelcome)
        return false;
      if (
        screen === OnboardingScreen.DiscoverySource &&
        opts.flags.skipDiscovery
      )
        return false;
      if (screen === OnboardingScreen.ModelSelection && opts.flags.skipModels)
        return false;
    }

    return true;
  });
}
