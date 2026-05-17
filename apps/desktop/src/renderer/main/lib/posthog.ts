import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { api } from "@/trpc/react";

let initialized = false;
let identifiedUserId: string | null = null;
let identifiedUserEmail: string | null = null;
let identifiedUserName: string | null = null;

interface AuthIdentity {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}

interface PostHogIdentityOptions extends AuthIdentity {
  machineId: string;
  telemetryEnabled?: boolean;
}

function initPostHog(apiKey: string, host: string, machineId: string): void {
  if (initialized) return;

  posthog.init(apiKey, {
    api_host: host,
    opt_out_capturing_by_default: true,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    persistence: "memory",
    person_profiles: "identified_only",
    bootstrap: {
      distinctID: machineId,
      isIdentifiedID: false,
    },
  });

  initialized = true;
}

function setPostHogIdentity({
  machineId,
  telemetryEnabled,
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
      distinct_id: machineId,
      $device_id: machineId,
    });
    if (telemetryEnabled !== undefined) {
      setTelemetryEnabled(telemetryEnabled);
    }
  }

  identifiedUserId = null;
  identifiedUserEmail = null;
  identifiedUserName = null;
}

function setTelemetryEnabled(enabled: boolean): void {
  if (!initialized) return;
  if (enabled) {
    posthog.opt_in_capturing();
  } else {
    posthog.opt_out_capturing();
  }
}

export function usePostHog() {
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

  // Initialize PostHog when config is available
  useEffect(() => {
    if (config?.apiKey && config.machineId) {
      initPostHog(config.apiKey, config.host, config.machineId);
    }
  }, [config?.apiKey, config?.host, config?.machineId]);

  // Keep machine ID anonymous; identify only when a logged-in user is known.
  // Waits for the subscription's initial event before touching identity to avoid
  // resetting from a half-known state.
  useEffect(() => {
    if (config?.machineId && authIdentity) {
      setPostHogIdentity({
        machineId: config.machineId,
        telemetryEnabled: config.enabled,
        userId: authIdentity.userId,
        userEmail: authIdentity.userEmail,
        userName: authIdentity.userName,
      });
    }
  }, [config?.machineId, config?.enabled, authIdentity]);

  // Sync opt-in/opt-out state when enabled changes
  useEffect(() => {
    if (config?.enabled !== undefined) {
      setTelemetryEnabled(config.enabled);
    }
  }, [config?.enabled]);

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
