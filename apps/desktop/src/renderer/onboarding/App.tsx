import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/trpc/react";
import { useOnboardingState } from "./hooks/useOnboardingState";
import { PhaseProgress } from "./components/shared/PhaseProgress";
import { OnboardingErrorBoundary } from "./components/ErrorBoundary";
import { useTranslation } from "react-i18next";

// Screens
import { WelcomeScreen } from "./components/screens/WelcomeScreen";
import { PermissionsScreen } from "./components/screens/PermissionsScreen";
import { DiscoverySourceScreen } from "./components/screens/DiscoverySourceScreen";
import { ModelSelectionScreen } from "./components/screens/ModelSelectionScreen";
import { SignInScreen } from "./components/screens/SignInScreen";
import { DownloadScreen } from "./components/screens/DownloadScreen";
import { MicTestScreen } from "./components/screens/MicTestScreen";
import { ShortcutScreen } from "./components/screens/ShortcutScreen";
import { SpokenLanguageScreen } from "./components/screens/SpokenLanguageScreen";
import { DictationTestScreen } from "./components/screens/DictationTestScreen";
import { CompletionScreen } from "./components/screens/CompletionScreen";

// Screen-ordering helpers
import {
  getActiveOnboardingScreens,
  phasesForScreens,
  SCREEN_PHASE,
} from "../../utils/onboarding-screens";

// Types
import {
  OnboardingScreen,
  ModelType,
  type OnboardingState,
  type OnboardingPreferences,
  type FeatureInterest,
  type DiscoverySource,
} from "../../types/onboarding";

interface PermissionStatus {
  microphone: "granted" | "denied" | "not-determined";
  accessibility: boolean;
}

/**
 * Main onboarding app with navigation state machine
 * Implements T026, T027, T028, T029 - Navigation & State Machine
 */
export function App() {
  const { t } = useTranslation();
  // State management
  const [currentScreen, setCurrentScreen] = useState<OnboardingScreen>(
    OnboardingScreen.Welcome,
  );
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: "not-determined",
    accessibility: false,
  });
  const [platform, setPlatform] = useState<string>("");
  const [preferences, setPreferences] = useState<
    Partial<OnboardingPreferences>
  >({});

  // Hooks
  const { state, isLoading, savePreferences, completeOnboarding } =
    useOnboardingState();

  // Ref to hold stable reference to savePreferences (avoids infinite loop in useEffect)
  const savePreferencesRef = useRef(savePreferences);
  savePreferencesRef.current = savePreferences;

  // Ref to ensure initialization only runs once (prevents re-running on dependency changes)
  const hasInitialized = useRef(false);

  // tRPC queries
  const featureFlagsQuery = api.onboarding.getFeatureFlags.useQuery();
  const skippedScreensQuery = api.onboarding.getSkippedScreens.useQuery();
  const utils = api.useUtils();

  // Effective model type: the in-progress selection, falling back to persisted
  // state so a mid-flow resume still resolves the cloud-only steps. Defaults to
  // Cloud (the longer, recommended path) until the user explicitly picks Local,
  // so the progress bar's denominator stays stable across the model-selection
  // boundary (it advances rather than regressing when Cloud is chosen).
  const resolveModelType = (selected: ModelType | undefined) =>
    selected ?? state?.selectedModelType ?? ModelType.Cloud;
  const effectiveModelType = resolveModelType(preferences.selectedModelType);

  // Helper so navigation can compute screens from a freshly-merged model type
  // (React state from setPreferences is not visible synchronously).
  const computeActiveScreens = useCallback(
    (modelType: ModelType) =>
      getActiveOnboardingScreens({
        modelType,
        flags: featureFlagsQuery.data,
        skipped: (skippedScreensQuery.data as OnboardingScreen[]) || [],
      }),
    [featureFlagsQuery.data, skippedScreensQuery.data],
  );

  // Get active screens. The cloud-only dictation steps are inserted only when
  // the cloud model is (or has been) selected.
  const getActiveScreens = useCallback(
    () => computeActiveScreens(effectiveModelType),
    [computeActiveScreens, effectiveModelType],
  );

  // Check permissions and return fresh values (for internal use during initialization)
  const checkPermissionsWithResult = useCallback(async () => {
    const [micStatus, accessStatus] = await Promise.all([
      utils.onboarding.checkMicrophonePermission.fetch(),
      utils.onboarding.checkAccessibilityPermission.fetch(),
    ]);

    setPermissions({
      microphone: micStatus as "granted" | "denied" | "not-determined",
      accessibility: accessStatus,
    });

    return { micStatus, accessStatus };
  }, [utils]);

  // Check permissions (public API for components)
  const checkPermissions = useCallback(async () => {
    await checkPermissionsWithResult();
  }, [checkPermissionsWithResult]);

  // Initialize platform and permissions (runs once when state is ready)
  useEffect(() => {
    // Wait for state to be ready before initializing
    if (isLoading) return;

    // Skip if already initialized (prevents re-running when dependencies change)
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const initialize = async () => {
      // Check initial permissions and platform
      // Use fresh results directly to avoid race condition
      const [{ micStatus, accessStatus }, platformResult] = await Promise.all([
        checkPermissionsWithResult(),
        utils.onboarding.getPlatform.fetch(),
      ]);
      setPlatform(platformResult);

      const hasMissingPermissions =
        micStatus !== "granted" ||
        (platformResult === "darwin" && !accessStatus);
      const hasCompletedOnboarding = !!state?.completedVersion;

      // If onboarding is being re-opened due to permission loss after completion,
      // force users to the permissions screen instead of resuming stale screens.
      if (hasCompletedOnboarding && hasMissingPermissions) {
        setCurrentScreen(OnboardingScreen.Permissions);
        return;
      }

      // Resume from last visited screen if available
      if (state?.lastVisitedScreen) {
        // Smart resume: if last screen was permissions and permissions now granted, skip to next
        // Use FRESH permission values, not stale React state
        if (
          state.lastVisitedScreen === OnboardingScreen.Permissions &&
          micStatus === "granted" &&
          (accessStatus || platformResult !== "darwin")
        ) {
          // Permissions granted, skip to next screen
          const activeScreens = getActiveScreens();
          const permissionsIndex = activeScreens.indexOf(
            OnboardingScreen.Permissions,
          );
          if (
            permissionsIndex !== -1 &&
            permissionsIndex < activeScreens.length - 1
          ) {
            setCurrentScreen(activeScreens[permissionsIndex + 1]);
          }
        } else {
          // Resume from the last visited screen — but only if it's still part
          // of the active flow (the model branch or feature flags may have
          // changed since it was saved). Otherwise stay on Welcome.
          const resumeScreen = state.lastVisitedScreen as OnboardingScreen;
          if (getActiveScreens().includes(resumeScreen)) {
            setCurrentScreen(resumeScreen);
          }
        }
      }
    };

    initialize();
  }, [
    isLoading,
    checkPermissionsWithResult,
    utils,
    state?.lastVisitedScreen,
    getActiveScreens,
  ]);

  // Save current screen for resume capability (telemetry tracked in backend)
  useEffect(() => {
    if (currentScreen !== OnboardingScreen.Welcome) {
      // Don't save Welcome screen, start from there if no progress
      // Use ref to avoid dependency on savePreferences which changes identity on mutation state
      savePreferencesRef.current({
        lastVisitedScreen: currentScreen,
      });
    }
  }, [currentScreen]);

  // Navigation functions (T028 - Back navigation)
  const navigateBack = useCallback(() => {
    const activeScreens = getActiveScreens();
    const currentIndex = activeScreens.indexOf(currentScreen);

    if (currentIndex > 0) {
      setCurrentScreen(activeScreens[currentIndex - 1]);
    }
  }, [currentScreen, getActiveScreens]);

  // The single advance implementation (T027 - Screen sequence logic).
  const advance = useCallback(
    (activeScreens: OnboardingScreen[]) => {
      const currentIndex = activeScreens.indexOf(currentScreen);
      if (currentIndex !== -1 && currentIndex < activeScreens.length - 1) {
        setCurrentScreen(activeScreens[currentIndex + 1]);
      }
    },
    [currentScreen],
  );

  const navigateNext = useCallback(
    () => advance(getActiveScreens()),
    [advance, getActiveScreens],
  );

  // Save preferences and navigate
  const handleSaveAndContinue = (
    newPreferences: Partial<OnboardingPreferences>,
  ) => {
    // Merge with existing preferences
    const updatedPreferences = { ...preferences, ...newPreferences };
    setPreferences(updatedPreferences);

    // Navigate immediately for responsive UX. Compute from the freshly-merged
    // model type — setPreferences is not visible to navigateNext synchronously,
    // so selecting Cloud here must not be evaluated against the stale value
    // (which would skip the cloud-only steps).
    advance(
      computeActiveScreens(
        resolveModelType(updatedPreferences.selectedModelType),
      ),
    );

    // Save to backend in background (non-blocking)
    // Preferences are already in React state, final completion will persist everything
    savePreferences(newPreferences).catch((error) => {
      console.error("Failed to save preferences:", error);
      // Error is already handled by the hook with toast
    });
  };

  // Handle feature interests selection (telemetry tracked in backend)
  const handleFeatureInterests = (
    interests: FeatureInterest[],
    details?: string,
  ) => {
    handleSaveAndContinue({
      featureInterests: interests,
      featureInterestsDetails: details,
    });
  };

  // Handle discovery source selection (telemetry tracked in backend)
  const handleDiscoverySource = (source: DiscoverySource, details?: string) => {
    handleSaveAndContinue({
      discoverySource: source,
      discoveryDetails: details,
    });
  };

  // Handle model selection (telemetry tracked in backend). The screen sends
  // the full recommendation with `followed` resolved against the choice.
  const handleModelSelection = (
    modelType: ModelType,
    recommendation?: OnboardingPreferences["modelRecommendation"],
  ) => {
    handleSaveAndContinue({
      selectedModelType: modelType,
      modelRecommendation: recommendation,
    });
  };

  // Handle completion (T039)
  const handleComplete = async () => {
    try {
      // Prepare final state
      const finalState: OnboardingState = {
        completedVersion: 1,
        completedAt: new Date().toISOString(),
        skippedScreens: skippedScreensQuery.data || [],
        featureInterests: preferences.featureInterests,
        discoverySource: preferences.discoverySource,
        selectedModelType: effectiveModelType,
        modelRecommendation: preferences.modelRecommendation,
      };

      // Complete onboarding (will also track completion event)
      await completeOnboarding(finalState);
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
    }
  };

  // Show loading state
  if (
    isLoading ||
    featureFlagsQuery.isLoading ||
    skippedScreensQuery.isLoading
  ) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {t("onboarding.app.loading")}
          </p>
        </div>
      </div>
    );
  }

  // Render current screen
  const renderScreen = () => {
    switch (currentScreen) {
      case OnboardingScreen.Welcome:
        return (
          <WelcomeScreen
            onNext={handleFeatureInterests}
            initialInterests={preferences.featureInterests}
          />
        );

      case OnboardingScreen.Permissions:
        return (
          <PermissionsScreen
            onNext={navigateNext}
            onBack={navigateBack}
            permissions={permissions}
            platform={platform}
            checkPermissions={checkPermissions}
          />
        );

      case OnboardingScreen.DiscoverySource:
        return (
          <DiscoverySourceScreen
            onNext={handleDiscoverySource}
            onBack={navigateBack}
            initialSource={preferences.discoverySource}
            initialDetails={preferences.discoveryDetails ?? ""}
          />
        );

      case OnboardingScreen.ModelSelection:
        return (
          <ModelSelectionScreen
            onNext={handleModelSelection}
            onBack={navigateBack}
            initialSelection={preferences.selectedModelType}
          />
        );

      case OnboardingScreen.SignIn:
        return <SignInScreen onNext={navigateNext} onBack={navigateBack} />;

      case OnboardingScreen.Download:
        return <DownloadScreen onNext={navigateNext} onBack={navigateBack} />;

      case OnboardingScreen.MicTest:
        return <MicTestScreen onNext={navigateNext} onBack={navigateBack} />;

      case OnboardingScreen.Shortcut:
        return <ShortcutScreen onNext={navigateNext} onBack={navigateBack} />;

      case OnboardingScreen.SpokenLanguage:
        return (
          <SpokenLanguageScreen onNext={navigateNext} onBack={navigateBack} />
        );

      // key forces a remount between the two try-it steps — they're the same
      // component type at the same tree position, so without it React reuses
      // the instance and the email transcript carries into the notes step.
      case OnboardingScreen.DictationEmail:
        return (
          <DictationTestScreen
            key="email"
            variant="email"
            onNext={navigateNext}
            onBack={navigateBack}
          />
        );

      case OnboardingScreen.DictationNotes:
        return (
          <DictationTestScreen
            key="notes"
            variant="notes"
            onNext={navigateNext}
            onBack={navigateBack}
          />
        );

      case OnboardingScreen.DictationLocal:
        return (
          <DictationTestScreen
            key="local"
            variant="simple"
            onNext={navigateNext}
            onBack={navigateBack}
          />
        );

      case OnboardingScreen.Completion:
        return (
          <CompletionScreen
            onComplete={handleComplete}
            onBack={navigateBack}
            modelType={effectiveModelType}
          />
        );

      default:
        return <div>{t("onboarding.app.unknownScreen")}</div>;
    }
  };

  // Phase-bar inputs: the active phase and how far the user is through it.
  const activeScreens = getActiveScreens();
  const phases = phasesForScreens(activeScreens);
  const currentPhase = SCREEN_PHASE[currentScreen];
  const screensInPhase = activeScreens.filter(
    (screen) => SCREEN_PHASE[screen] === currentPhase,
  );
  const phaseFill =
    screensInPhase.length === 0
      ? 0
      : (screensInPhase.indexOf(currentScreen) + 1) / screensInPhase.length;

  return (
    <OnboardingErrorBoundary>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-sm text-foreground antialiased [background-image:radial-gradient(1200px_700px_at_50%_-10%,var(--color-brand-glow)_0%,transparent_60%)]">
        {/* native titlebar drag region (traffic lights drawn by titleBarOverlay) */}
        <div className="h-10 shrink-0 [-webkit-app-region:drag]" />
        <PhaseProgress
          phases={phases}
          currentPhase={currentPhase}
          fill={phaseFill}
        />
        <div className="relative flex-1 overflow-hidden">{renderScreen()}</div>
      </div>
    </OnboardingErrorBoundary>
  );
}
