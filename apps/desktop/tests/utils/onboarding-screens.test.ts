import { describe, expect, it } from "vitest";
import {
  getActiveOnboardingScreens,
  phasesForScreens,
} from "../../src/utils/onboarding-screens";
import { OnboardingScreen, ModelType } from "../../src/types/onboarding";

const flags = {
  skipWelcome: false,
  skipFeatures: false,
  skipDiscovery: false,
  skipModels: false,
};

describe("getActiveOnboardingScreens", () => {
  it("cloud flow: SignIn setup + shared config + try-it + draft, no Download", () => {
    const screens = getActiveOnboardingScreens({
      modelType: ModelType.Cloud,
      flags,
      skipped: [],
    });
    expect(screens).toEqual([
      OnboardingScreen.Welcome,
      OnboardingScreen.DiscoverySource,
      OnboardingScreen.ModelSelection,
      OnboardingScreen.SignIn,
      OnboardingScreen.Permissions,
      OnboardingScreen.MicTest,
      OnboardingScreen.Shortcut,
      OnboardingScreen.SpokenLanguage,
      OnboardingScreen.DictationEmail,
      OnboardingScreen.DictationNotes,
      OnboardingScreen.DraftIntro,
      OnboardingScreen.DraftShortcut,
      OnboardingScreen.DraftCompose,
      OnboardingScreen.DraftSelection,
      OnboardingScreen.Completion,
    ]);
  });

  it("local flow: Download setup + shared config, no SignIn or try-it", () => {
    const screens = getActiveOnboardingScreens({
      modelType: ModelType.Local,
      flags,
      skipped: [],
    });
    expect(screens).toEqual([
      OnboardingScreen.Welcome,
      OnboardingScreen.DiscoverySource,
      OnboardingScreen.ModelSelection,
      OnboardingScreen.Download,
      OnboardingScreen.Permissions,
      OnboardingScreen.MicTest,
      OnboardingScreen.Shortcut,
      OnboardingScreen.SpokenLanguage,
      OnboardingScreen.DictationLocal,
      OnboardingScreen.Completion,
    ]);
  });

  it("mic/shortcut/language are shared across both branches", () => {
    const shared = [
      OnboardingScreen.MicTest,
      OnboardingScreen.Shortcut,
      OnboardingScreen.SpokenLanguage,
    ];
    const cloud = getActiveOnboardingScreens({
      modelType: ModelType.Cloud,
      flags,
      skipped: [],
    });
    const local = getActiveOnboardingScreens({
      modelType: ModelType.Local,
      flags,
      skipped: [],
    });
    for (const screen of shared) {
      expect(cloud).toContain(screen);
      expect(local).toContain(screen);
    }
  });

  it("hides both setup steps and try-it when model not yet chosen", () => {
    const screens = getActiveOnboardingScreens({
      modelType: undefined,
      flags,
      skipped: [],
    });
    expect(screens).not.toContain(OnboardingScreen.SignIn);
    expect(screens).not.toContain(OnboardingScreen.Download);
    expect(screens).not.toContain(OnboardingScreen.DictationEmail);
    expect(screens).not.toContain(OnboardingScreen.DictationNotes);
    expect(screens).not.toContain(OnboardingScreen.DictationLocal);
    expect(screens).not.toContain(OnboardingScreen.DraftIntro);
    expect(screens).not.toContain(OnboardingScreen.DraftShortcut);
    expect(screens).not.toContain(OnboardingScreen.DraftCompose);
    expect(screens).not.toContain(OnboardingScreen.DraftSelection);
    // shared config still present
    expect(screens).toContain(OnboardingScreen.MicTest);
  });

  it("honors skipModels and the skipped list", () => {
    const screens = getActiveOnboardingScreens({
      modelType: ModelType.Cloud,
      flags: { ...flags, skipModels: true },
      skipped: [OnboardingScreen.DiscoverySource],
    });
    expect(screens).not.toContain(OnboardingScreen.ModelSelection);
    expect(screens).not.toContain(OnboardingScreen.DiscoverySource);
    expect(screens).toContain(OnboardingScreen.MicTest);
  });
});

describe("phasesForScreens", () => {
  it("cloud has 6 phases including Try it and Draft", () => {
    const screens = getActiveOnboardingScreens({
      modelType: ModelType.Cloud,
      flags,
      skipped: [],
    });
    expect(phasesForScreens(screens)).toEqual([
      "getStarted",
      "setUp",
      "configure",
      "tryIt",
      "draft",
      "done",
    ]);
  });

  it("local has 5 phases including Try it, no Draft", () => {
    const screens = getActiveOnboardingScreens({
      modelType: ModelType.Local,
      flags,
      skipped: [],
    });
    expect(phasesForScreens(screens)).toEqual([
      "getStarted",
      "setUp",
      "configure",
      "tryIt",
      "done",
    ]);
  });

  it("a fully-skipped phase yields no segment", () => {
    const screens = getActiveOnboardingScreens({
      modelType: ModelType.Cloud,
      flags: { ...flags, skipWelcome: true, skipDiscovery: true },
      skipped: [OnboardingScreen.Permissions],
    });
    expect(phasesForScreens(screens)).toEqual([
      "setUp",
      "configure",
      "tryIt",
      "draft",
      "done",
    ]);
  });
});
