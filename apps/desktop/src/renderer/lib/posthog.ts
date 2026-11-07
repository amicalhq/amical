import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { api, trpcClient } from "@/trpc/react";

export type RendererSurface = "main" | "widget" | "notes" | "onboarding";

interface RendererTelemetryConfig {
  apiKey: string;
  host: string;
  machineId: string;
  enabled: boolean;
  feedbackSurveyId: string;
  commonProperties: Record<string, unknown>;
}

interface AuthIdentity {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}

interface PostHogIdentityOptions extends AuthIdentity {
  machineId: string;
}

let initialized = false;
let identifiedUserId: string | null = null;
let identifiedUserEmail: string | null = null;
let identifiedUserName: string | null = null;
let rendererProperties: Record<string, unknown> = {};
let telemetryEnabled = false;
let telemetryEnabledSubscriptionStarted = false;

function logMissingConfig(variable: string): void {
  if (import.meta.env.DEV) {
    console.error(
      `${variable} variable required by PostHog is missing or un-configured, ` +
        `this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
    );
  }
}

export function initializePostHog(
  config: RendererTelemetryConfig,
  surface: RendererSurface,
): void {
  if (initialized) {
    subscribeToTelemetryEnabledChanges();
    return;
  }
  if (!config.apiKey) {
    logMissingConfig("POSTHOG_API_KEY");
    return;
  }
  if (!config.host) {
    logMissingConfig("POSTHOG_HOST");
    return;
  }
  if (!config.machineId) return;

  posthog.init(config.apiKey, {
    api_host: config.host,
    opt_out_capturing_by_default: true,
    autocapture: false,
    capture_exceptions: true,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    persistence: "memory",
    person_profiles: "identified_only",
    bootstrap: {
      distinctID: config.machineId,
      isIdentifiedID: false,
    },
  });

  initialized = true;
  rendererProperties = {
    ...config.commonProperties,
    $device_id: config.machineId,
    runtime: "renderer",
    surface,
  };
  posthog.register(rendererProperties);
  setTelemetryEnabled(config.enabled);
  subscribeToTelemetryEnabledChanges();
}

export async function initializeRendererPostHog(
  surface: RendererSurface,
): Promise<void> {
  try {
    const config = await trpcClient.settings.getTelemetryConfig.query();
    initializePostHog(config, surface);
  } catch (error) {
    console.error("Failed to initialize renderer telemetry", error);
  }
}

export function captureRendererException(
  error: unknown,
  properties: Record<string, unknown>,
): void {
  if (!initialized) return;
  posthog.captureException(error, properties);
}

function setPostHogIdentity({
  machineId,
  userId,
  userEmail,
  userName,
}: PostHogIdentityOptions): void {
  if (!initialized) return;

  if (userId) {
    if (
      identifiedUserId === userId &&
      identifiedUserEmail === (userEmail ?? null) &&
      identifiedUserName === (userName ?? null)
    ) {
      return;
    }

    posthog.identify(userId, {
      ...(userEmail && { email: userEmail }),
      ...(userName && { name: userName }),
    });
    identifiedUserId = userId;
    identifiedUserEmail = userEmail ?? null;
    identifiedUserName = userName ?? null;
    return;
  }

  if (identifiedUserId) {
    posthog.reset(false);
    posthog.register({
      ...rendererProperties,
      distinct_id: machineId,
      $device_id: machineId,
    });
    setTelemetryEnabled(telemetryEnabled);
  }

  identifiedUserId = null;
  identifiedUserEmail = null;
  identifiedUserName = null;
}

function setTelemetryEnabled(enabled: boolean): void {
  telemetryEnabled = enabled;
  if (!initialized) return;
  if (enabled) {
    posthog.opt_in_capturing({ captureEventName: false });
  } else {
    posthog.opt_out_capturing();
  }
}

function subscribeToTelemetryEnabledChanges(): void {
  if (telemetryEnabledSubscriptionStarted || !initialized) return;

  telemetryEnabledSubscriptionStarted = true;
  try {
    trpcClient.settings.onTelemetryEnabledChange.subscribe(undefined, {
      onData: setTelemetryEnabled,
      onError: (error) => {
        telemetryEnabledSubscriptionStarted = false;
        console.error("Renderer telemetry settings subscription failed", error);
      },
    });
  } catch (error) {
    telemetryEnabledSubscriptionStarted = false;
    console.error("Failed to subscribe to renderer telemetry settings", error);
  }
}

export function usePostHog(surface?: RendererSurface) {
  const { data: config } = api.settings.getTelemetryConfig.useQuery();
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity | null>(null);

  api.auth.onAuthStateChange.useSubscription(undefined, {
    onData: (authState) => {
      setAuthIdentity({
        userId: authState.userId,
        userEmail: authState.userEmail,
        userName: authState.userName,
      });
    },
  });

  useEffect(() => {
    if (config && surface) {
      initializePostHog(config, surface);
    }
  }, [config, surface]);

  useEffect(() => {
    if (config?.machineId && authIdentity) {
      setPostHogIdentity({
        machineId: config.machineId,
        userId: authIdentity.userId,
        userEmail: authIdentity.userEmail,
        userName: authIdentity.userName,
      });
    }
  }, [config?.machineId, authIdentity]);

  const showFeedbackSurvey = () => {
    if (!initialized || !config?.feedbackSurveyId) return;
    posthog.onSurveysLoaded(() => {
      posthog.displaySurvey(config.feedbackSurveyId);
    });
  };

  return {
    enabled: config?.enabled ?? false,
    hasSurvey: !!config?.feedbackSurveyId,
    showFeedbackSurvey,
  };
}

export { posthog };
