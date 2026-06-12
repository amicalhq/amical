import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingService } from "../../src/services/onboarding-service";
import {
  OnboardingScreen,
  ModelType,
  type OnboardingState,
} from "../../src/types/onboarding";
import type { SettingsService } from "../../src/services/settings-service";
import type { TelemetryService } from "../../src/services/telemetry-service";
import type { ModelService } from "../../src/services/model-service";

const createService = (persistedOnboarding: Record<string, unknown> | null) => {
  const stored: { onboarding: Record<string, unknown> | undefined } = {
    onboarding: persistedOnboarding ?? undefined,
  };
  const settingsService = {
    getAllSettings: vi.fn(async () => ({ ...stored })),
    updateSettings: vi.fn(async (update: { onboarding?: unknown }) => {
      stored.onboarding = update.onboarding as Record<string, unknown>;
    }),
  };
  const telemetryService = {
    trackOnboardingCompleted: vi.fn(),
    trackOnboardingModelSelected: vi.fn(),
  };
  const modelService = {
    getSelectedModel: vi.fn(async () => null),
    getDownloadedModels: vi.fn(async () => ({ "whisper-medium": {} })),
    setSelectedModel: vi.fn(async () => undefined),
  };
  const service = new OnboardingService(
    settingsService as unknown as SettingsService,
    telemetryService as unknown as TelemetryService,
    modelService as unknown as ModelService,
  );
  return { service, settingsService, telemetryService, modelService, stored };
};

const finalState = (
  overrides: Partial<OnboardingState> = {},
): OnboardingState => ({
  completedVersion: 1,
  completedAt: "",
  skippedScreens: [],
  featureInterests: undefined,
  discoverySource: undefined,
  selectedModelType: ModelType.Cloud,
  modelRecommendation: undefined,
  ...overrides,
});

describe("OnboardingService.completeOnboarding", () => {
  it("fills resumed completions from persisted state (quit-and-resume loses renderer memory)", async () => {
    const { service, telemetryService } = createService({
      lastVisitedScreen: "completion",
      featureInterests: ["taking_notes"],
      discoverySource: "reddit",
      selectedModelType: "cloud",
      modelRecommendation: { suggested: "cloud", reason: "r", followed: true },
    });

    await service.completeOnboarding(finalState());

    expect(telemetryService.trackOnboardingCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        features_selected: ["taking_notes"],
        discovery_source: "reddit",
        recommendation_followed: true,
      }),
    );
  });

  it("prefers the in-flight answers over persisted ones", async () => {
    const { service, telemetryService } = createService({
      featureInterests: ["taking_notes"],
      discoverySource: "reddit",
    });

    await service.completeOnboarding(
      finalState({
        featureInterests: ["drafting_emails"] as never,
        discoverySource: "github" as never,
      }),
    );

    expect(telemetryService.trackOnboardingCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        features_selected: ["drafting_emails"],
        discovery_source: "github",
      }),
    );
  });

  it("applies the cloud model at completion, when sign-in has happened", async () => {
    const { service, modelService } = createService(null);

    await service.completeOnboarding(finalState());

    expect(modelService.setSelectedModel).toHaveBeenCalledWith("amical-cloud");
  });

  it("applies the first downloaded local model at completion, when the download has happened", async () => {
    const { service, modelService } = createService(null);

    await service.completeOnboarding(
      finalState({ selectedModelType: ModelType.Local }),
    );

    expect(modelService.setSelectedModel).toHaveBeenCalledWith(
      "whisper-medium",
    );
  });

  it("completes even when applying the model fails", async () => {
    const { service, modelService, telemetryService } = createService(null);
    modelService.setSelectedModel.mockRejectedValueOnce(
      new Error("Authentication required for cloud models"),
    );

    await service.completeOnboarding(finalState());

    expect(telemetryService.trackOnboardingCompleted).toHaveBeenCalled();
  });
});

describe("OnboardingService.savePreferences", () => {
  it("does not apply the model at selection time (sign-in/download come on later screens)", async () => {
    const { service, modelService, telemetryService } = createService(null);

    await service.savePreferences({ selectedModelType: ModelType.Cloud });

    expect(modelService.setSelectedModel).not.toHaveBeenCalled();
    expect(telemetryService.trackOnboardingModelSelected).toHaveBeenCalledWith({
      model_type: "cloud",
      recommendation_followed: false,
    });
  });
});

describe("OnboardingService.getSkippedScreens", () => {
  const FLAG_VARS = [
    "ONBOARDING_SKIP_WELCOME",
    "ONBOARDING_SKIP_FEATURES",
    "ONBOARDING_SKIP_DISCOVERY",
    "ONBOARDING_SKIP_MODELS",
  ];

  afterEach(() => {
    for (const name of FLAG_VARS) {
      delete process.env[name];
    }
  });

  it("maps the legacy skipFeatures flag to Welcome, never to a non-screen id", () => {
    const { service } = createService(null);
    process.env.ONBOARDING_SKIP_FEATURES = "true";

    const skipped = service.getSkippedScreens();

    expect(skipped).toEqual([OnboardingScreen.Welcome]);
  });

  it("does not duplicate Welcome when both legacy flags are set, and uses real screen ids", () => {
    const { service } = createService(null);
    process.env.ONBOARDING_SKIP_WELCOME = "true";
    process.env.ONBOARDING_SKIP_FEATURES = "true";
    process.env.ONBOARDING_SKIP_DISCOVERY = "true";
    process.env.ONBOARDING_SKIP_MODELS = "true";

    const skipped = service.getSkippedScreens();

    expect(skipped).toEqual([
      OnboardingScreen.Welcome,
      OnboardingScreen.DiscoverySource,
      OnboardingScreen.ModelSelection,
    ]);
  });
});
