// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  identify: vi.fn(),
  init: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  subscribe: vi.fn(),
  useAuthSubscription: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    captureException: mocks.captureException,
    identify: mocks.identify,
    init: mocks.init,
    opt_in_capturing: mocks.optIn,
    opt_out_capturing: mocks.optOut,
    register: mocks.register,
    reset: mocks.reset,
  },
}));

vi.mock("@/trpc/react", () => ({
  api: {
    auth: {
      onAuthStateChange: {
        useSubscription: mocks.useAuthSubscription,
      },
    },
    settings: {
      getTelemetryConfig: {
        useQuery: mocks.useQuery,
      },
    },
  },
  trpcClient: {
    settings: {
      getTelemetryConfig: {
        query: vi.fn(),
      },
      onTelemetryEnabledChange: {
        subscribe: mocks.subscribe,
      },
    },
  },
}));

describe("renderer PostHog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.subscribe.mockReturnValue({ unsubscribe: vi.fn() });
    mocks.useQuery.mockReturnValue({ data: undefined });
  });

  afterEach(cleanup);

  it("uses the main identity and common properties for renderer exceptions", async () => {
    const { initializePostHog, captureRendererException } = await import(
      "../../src/renderer/lib/posthog"
    );

    initializePostHog(
      {
        apiKey: "phc_test",
        host: "https://posthog.test",
        machineId: "machine-1",
        enabled: true,
        feedbackSurveyId: "survey-1",
        commonProperties: {
          app_version: "1.2.3",
          machine_id: "machine-1",
          app_is_packaged: true,
          system_info: { os_platform: "darwin", os_arch: "arm64" },
        },
      },
      "widget",
    );

    expect(mocks.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://posthog.test",
        autocapture: false,
        capture_exceptions: true,
        bootstrap: {
          distinctID: "machine-1",
          isIdentifiedID: false,
        },
      }),
    );
    expect(mocks.register).toHaveBeenCalledWith({
      app_version: "1.2.3",
      machine_id: "machine-1",
      app_is_packaged: true,
      system_info: { os_platform: "darwin", os_arch: "arm64" },
      $device_id: "machine-1",
      runtime: "renderer",
      surface: "widget",
    });
    expect(mocks.optIn).toHaveBeenCalledOnce();

    const error = new Error("render failed");
    captureRendererException(error, {
      error_context: "root_render_failed",
      surface: "widget",
    });

    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      error_context: "root_render_failed",
      surface: "widget",
    });
  });

  it("keeps renderer properties and current consent after logout", async () => {
    const config = {
      apiKey: "phc_test",
      host: "https://posthog.test",
      machineId: "machine-1",
      enabled: true,
      feedbackSurveyId: "survey-1",
      commonProperties: { app_version: "1.2.3" },
    };
    mocks.useQuery.mockReturnValue({ data: config });

    const { initializePostHog, usePostHog } = await import(
      "../../src/renderer/lib/posthog"
    );
    initializePostHog(config, "widget");

    function PostHogHook(): React.ReactNode {
      usePostHog("widget");
      return null;
    }

    render(React.createElement(PostHogHook));
    await act(async () => {
      const options = mocks.useAuthSubscription.mock.lastCall?.[1];
      options.onData({ userId: "user-1", userEmail: "user@example.com" });
    });
    expect(mocks.identify).toHaveBeenCalledWith("user-1", {
      email: "user@example.com",
    });

    const telemetrySubscription = mocks.subscribe.mock.lastCall?.[1];
    telemetrySubscription.onData(false);
    mocks.optIn.mockClear();
    mocks.optOut.mockClear();

    await act(async () => {
      const options = mocks.useAuthSubscription.mock.lastCall?.[1];
      options.onData({ userId: null, userEmail: null, userName: null });
    });

    expect(mocks.reset).toHaveBeenCalledWith(false);
    expect(mocks.register).toHaveBeenLastCalledWith({
      app_version: "1.2.3",
      runtime: "renderer",
      surface: "widget",
      distinct_id: "machine-1",
      $device_id: "machine-1",
    });
    expect(mocks.optOut).toHaveBeenCalledOnce();
    expect(mocks.optIn).not.toHaveBeenCalled();
  });

  it("applies telemetry setting changes received from the main process", async () => {
    const config = {
      apiKey: "phc_test",
      host: "https://posthog.test",
      machineId: "machine-1",
      enabled: true,
      feedbackSurveyId: "survey-1",
      commonProperties: {},
    };
    mocks.useQuery.mockReturnValue({ data: config });

    const { initializePostHog, usePostHog } = await import(
      "../../src/renderer/lib/posthog"
    );
    initializePostHog(config, "widget");
    mocks.optIn.mockClear();
    mocks.optOut.mockClear();

    const options = mocks.subscribe.mock.lastCall?.[1];
    options.onData(false);
    expect(mocks.optOut).toHaveBeenCalledOnce();

    mocks.optIn.mockClear();
    function PostHogHook(): React.ReactNode {
      usePostHog("widget");
      return null;
    }
    render(React.createElement(PostHogHook));
    expect(mocks.optIn).not.toHaveBeenCalled();

    options.onData(true);
    expect(mocks.optIn).toHaveBeenCalledOnce();
  });
});
