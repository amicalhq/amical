import React, { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/trpc/react";
import { useOnboardingState } from "./hooks/useOnboardingState";
import { ProgressIndicator } from "./components/shared/ProgressIndicator";
import { OnboardingErrorBoundary } from "./components/ErrorBoundary";

// Screens
import { WelcomeScreen } from "./components/screens/WelcomeScreen";
import { PermissionsScreen } from "./components/screens/PermissionsScreen";
import { DiscoverySourceScreen } from "./components/screens/DiscoverySourceScreen";
import { ModelSelectionScreen } from "./components/screens/ModelSelectionScreen";
import { CompletionScreen } from "./components/screens/CompletionScreen";

// Types
import {
  OnboardingScreen,
  type OnboardingState,
  type OnboardingPreferences,
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
  const [discoveryDetails, setDiscoveryDetails] = useState<string>("");

  // Hooks
  const { state, isLoading, savePreferences, completeOnboarding } =
    useOnboardingState();

  // Ref to hold stable reference to savePreferences (avoids infinite loop in useEffect)
  const savePreferencesRef = useRef(savePreferences);
  savePreferencesRef.current = savePreferences;

  // Ref to ensure initialization only runs once (prevents re-running on dependency changes)
  const hasInitialized = useRef(false);

  // tRPC queries
  const skippedScreensQuery = api.onboarding.getSkippedScreens.useQuery();
  const utils = api.useUtils();

  // Screen order - can be modified based on feature flags
  const screenOrder: OnboardingScreen[] = [
    OnboardingScreen.Welcome,
    OnboardingScreen.Permissions,
    OnboardingScreen.DiscoverySource,
    OnboardingScreen.ModelSelection,
    OnboardingScreen.Completion,
  ];

  // Get active screens (excluding skipped ones)
  const getActiveScreens = useCallback(() => {
    const skipped = new Set(skippedScreensQuery.data || []);

    // Filter out skipped screens based on feature flags
    return screenOrder.filter((screen) => {
      if (skipped.has(screen)) return false;

      return true;
    });
  }, [skippedScreensQuery.data]);

  // Get current screen index
  const getCurrentScreenIndex = useCallback(() => {
    const activeScreens = getActiveScreens();
    return activeScreens.indexOf(currentScreen);
  }, [currentScreen, getActiveScreens]);

  // Get total number of screens
  const getTotalScreens = useCallback(() => {
    return getActiveScreens().length;
  }, [getActiveScreens]);

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
          // Resume from last visited screen
          setCurrentScreen(state.lastVisitedScreen as OnboardingScreen);
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

  // Navigate to next screen (T027 - Screen sequence logic)
  const navigateNext = useCallback(() => {
    const activeScreens = getActiveScreens();
    const currentIndex = activeScreens.indexOf(currentScreen);

    if (currentIndex < activeScreens.length - 1) {
      setCurrentScreen(activeScreens[currentIndex + 1]);
    }
  }, [currentScreen, getActiveScreens]);

  // Save preferences and navigate
  const handleSaveAndContinue = (
    newPreferences: Partial<OnboardingPreferences>,
  ) => {
    // Merge with existing preferences
    const updatedPreferences = { ...preferences, ...newPreferences };
    setPreferences(updatedPreferences);

    // Navigate immediately for responsive UX
    navigateNext();

    // Save to backend in background (non-blocking)
    // Preferences are already in React state, final completion will persist everything
    savePreferences(newPreferences).catch((error) => {
      console.error("Failed to save preferences:", error);
      // Error is already handled by the hook with toast
    });
  };

  // Handle discovery source selection (telemetry tracked in backend)
  const handleDiscoverySource = (source: DiscoverySource, details?: string) => {
    setDiscoveryDetails(details || "");
    handleSaveAndContinue({
      discoverySource: source,
      discoveryDetails: details,
    });
  };

  // Handle completion (T039)
  const handleComplete = async () => {
    try {
      const validScreens = new Set(Object.values(OnboardingScreen));
      const skippedScreens = (skippedScreensQuery.data || []).filter((screen) =>
        validScreens.has(screen),
      );
      // Prepare final state
      const finalState: OnboardingState = {
        completedVersion: 1,
        completedAt: new Date().toISOString(),
        skippedScreens,
        discoverySource: preferences.discoverySource,
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
    skippedScreensQuery.isLoading
  ) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading onboarding...</p>
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
            onNext={navigateNext}
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
            initialDetails={discoveryDetails}
          />
        );

      case OnboardingScreen.ModelSelection:
        return (
          <ModelSelectionScreen
            onNext={navigateNext}
            onBack={navigateBack}
          />
        );

      case OnboardingScreen.Completion:
        return (
          <CompletionScreen
            onComplete={handleComplete}
            onBack={navigateBack}
          />
        );

      default:
        return <div>Unknown screen</div>;
    }
  };

  return (
    <OnboardingErrorBoundary>
      <div className="h-screen w-screen bg-background text-foreground">
        {/* Progress Indicator (T029) */}
        <div className="fixed left-0 right-0 top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto max-w-2xl px-8 pb-4 pt-6">
            <ProgressIndicator
              current={getCurrentScreenIndex() + 1}
              total={getTotalScreens()}
            />
          </div>
        </div>

        {/* Screen Content */}
        <div className="h-full overflow-auto pt-20">{renderScreen()}</div>
      </div>
    </OnboardingErrorBoundary>
  );
}
