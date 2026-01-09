import { useEffect } from "react";
import posthog from "posthog-js";
import { api } from "@/trpc/react";

let initialized = false;

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
    bootstrap: {
      distinctID: machineId,
    },
  });

  initialized = true;
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

  // Initialize PostHog when config is available
  useEffect(() => {
    if (config?.apiKey) {
      initPostHog(config.apiKey, config.host, config.machineId);
    }
  }, [config?.apiKey, config?.host, config?.machineId]);

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
