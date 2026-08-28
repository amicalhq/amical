import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryService } from "../../src/services/telemetry-service";
import type { PostHogClient } from "../../src/services/posthog-client";
import type { SettingsService } from "../../src/services/settings-service";

interface AuthStateFixture {
  isAuthenticated: boolean;
  userInfo?: {
    sub: string;
    email?: string;
    name?: string;
  };
}

function createHarness(auth?: AuthStateFixture) {
  const posthog = {
    capture: vi.fn(),
    captureException: vi.fn(),
    captureExceptionImmediate: vi.fn(),
    identify: vi.fn(),
    optIn: vi.fn(() => Promise.resolve()),
    optOut: vi.fn(() => Promise.resolve()),
    shutdown: vi.fn(() => Promise.resolve()),
  };

  const identity: {
    userId: string | null;
    email?: string;
    name?: string;
  } = {
    userId: null,
  };

  const client = {
    posthog,
    get machineId() {
      return "machine-1";
    },
    get distinctId() {
      return identity.userId || "machine-1";
    },
    get isIdentified() {
      return !!identity.userId;
    },
    get identifiedUser() {
      return identity.userId
        ? {
            userId: identity.userId,
            email: identity.email,
            name: identity.name,
          }
        : null;
    },
    get systemInfo() {
      return null;
    },
    get eventIdentityProperties() {
      return {
        $device_id: "machine-1",
        $process_person_profile: !!identity.userId,
        $is_identified: !!identity.userId,
      };
    },
    setIdentifiedUser: vi.fn(
      (userId: string, email?: string, name?: string) => {
        identity.userId = userId;
        identity.email = email;
        identity.name = name;
      },
    ),
    clearIdentifiedUser: vi.fn(() => {
      identity.userId = null;
      identity.email = undefined;
      identity.name = undefined;
    }),
    shutdown: vi.fn(() => Promise.resolve()),
  } as unknown as PostHogClient;

  const settingsService = {
    getTelemetrySettings: vi.fn(() => Promise.resolve({ enabled: true })),
    getAllSettings: vi.fn(() => Promise.resolve({ auth })),
    setTelemetrySettings: vi.fn(() => Promise.resolve()),
  } as unknown as SettingsService;

  return {
    client,
    posthog,
    service: TelemetryService.createForTests(client, settingsService),
    settingsService,
  };
}

describe("TelemetryService identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures anonymous events with machine ID but without person processing", async () => {
    const { posthog, service } = createHarness();

    await service.initialize();
    service.trackAppLaunch();

    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: "machine-1",
      event: "app_launch",
      properties: expect.objectContaining({
        machine_id: "machine-1",
        $device_id: "machine-1",
        $process_person_profile: false,
        $is_identified: false,
      }),
    });
  });

  it("exposes the common event properties used by renderer telemetry", async () => {
    const { service } = createHarness();

    await service.initialize();

    expect(service.getCommonProperties()).toEqual({
      app_version: "0.1.0-test",
      machine_id: "machine-1",
      app_is_packaged: false,
      system_info: {},
    });
  });

  it("emits telemetry enabled changes for renderer subscribers", async () => {
    const { service } = createHarness();
    const onEnabledChange = vi.fn();
    service.on("enabled-changed", onEnabledChange);

    await service.initialize();
    await service.setEnabled(false);
    await service.setEnabled(true);

    expect(onEnabledChange.mock.calls).toEqual([[false], [true]]);
  });

  it("reports API contract failures without the rejected response", async () => {
    const { posthog, service } = createHarness();

    await service.initialize();
    service.captureContractFailure(
      "remote_config_response_invalid",
      "schema_mismatch",
      { status: 200 },
    );

    expect(posthog.captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "ClientContractError",
        message: "Response did not match its expected schema",
      }),
      "machine-1",
      expect.objectContaining({
        error_context: "remote_config_response_invalid",
        failure_kind: "schema_mismatch",
        status: 200,
      }),
    );
  });

  it("identifies on login and captures later events with user ID", async () => {
    const { client, posthog, service } = createHarness();

    await service.initialize();
    service.identifyUser("user-1", "user@example.com", "Test User");
    service.trackAppLaunch();

    expect(client.setIdentifiedUser).toHaveBeenCalledWith(
      "user-1",
      "user@example.com",
      "Test User",
    );
    expect(posthog.identify).toHaveBeenCalledWith({
      distinctId: "user-1",
      properties: expect.objectContaining({
        email: "user@example.com",
        name: "Test User",
        $anon_distinct_id: "machine-1",
      }),
    });
    expect(posthog.capture).toHaveBeenLastCalledWith({
      distinctId: "user-1",
      event: "app_launch",
      properties: expect.objectContaining({
        machine_id: "machine-1",
        $device_id: "machine-1",
        $process_person_profile: true,
        $is_identified: true,
      }),
    });
  });

  it("restores anonymous machine ID capture after logout", async () => {
    const { client, posthog, service } = createHarness();

    await service.initialize();
    service.identifyUser("user-1");
    service.resetUser();
    service.trackAppLaunch();

    expect(client.clearIdentifiedUser).toHaveBeenCalled();
    expect(posthog.capture).toHaveBeenLastCalledWith({
      distinctId: "machine-1",
      event: "app_launch",
      properties: expect.objectContaining({
        $device_id: "machine-1",
        $process_person_profile: false,
        $is_identified: false,
      }),
    });
  });

  it("uses persisted logged-in user identity during initialization", async () => {
    const { client, posthog, service } = createHarness({
      isAuthenticated: true,
      userInfo: {
        sub: "user-from-settings",
        email: "persisted@example.com",
        name: "Persisted User",
      },
    });

    await service.initialize();
    service.trackAppLaunch();

    expect(client.setIdentifiedUser).toHaveBeenCalledWith(
      "user-from-settings",
      "persisted@example.com",
      "Persisted User",
    );
    expect(posthog.identify).toHaveBeenCalledWith({
      distinctId: "user-from-settings",
      properties: expect.objectContaining({
        email: "persisted@example.com",
        name: "Persisted User",
        $anon_distinct_id: "machine-1",
      }),
    });
    expect(posthog.capture).toHaveBeenCalledWith({
      distinctId: "user-from-settings",
      event: "app_launch",
      properties: expect.objectContaining({
        $device_id: "machine-1",
        $process_person_profile: true,
        $is_identified: true,
      }),
    });
  });
});

describe("TelemetryService flood guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops events past the burst for one event name without touching others", async () => {
    const { posthog, service } = createHarness();
    await service.initialize();

    for (let i = 0; i < 15; i++) {
      service.trackAppLaunch();
    }
    service.trackNoteCreated({
      note_id: 1,
      has_initial_content: false,
      has_icon: false,
    });

    const captured = posthog.capture.mock.calls.map(
      ([msg]) => (msg as { event: string }).event,
    );
    expect(captured.filter((e: string) => e === "app_launch")).toHaveLength(10);
    expect(captured.filter((e: string) => e === "note_created")).toHaveLength(
      1,
    );
  });

  it("refills one event per interval after the burst is drained", async () => {
    const { posthog, service } = createHarness();
    await service.initialize();

    for (let i = 0; i < 12; i++) {
      service.trackAppLaunch();
    }
    expect(posthog.capture).toHaveBeenCalledTimes(10);

    vi.advanceTimersByTime(10_000);
    service.trackAppLaunch();
    service.trackAppLaunch();
    expect(posthog.capture).toHaveBeenCalledTimes(11);
  });

  it("suppresses repeats of one exception but lets a different one through", async () => {
    const { posthog, service } = createHarness();
    await service.initialize();

    const looping = new Error("boom");
    for (let i = 0; i < 8; i++) {
      service.captureException(looping);
    }
    expect(posthog.captureException).toHaveBeenCalledTimes(5);

    service.captureException(new Error("something else"));
    expect(posthog.captureException).toHaveBeenCalledTimes(6);
  });

  it("does not throw when the error resists fingerprinting", async () => {
    const { posthog, service } = createHarness();
    await service.initialize();

    const hostile = {
      toString() {
        throw new Error("broken conversion");
      },
    };
    expect(() => service.captureException(hostile)).not.toThrow();
    expect(posthog.captureException).toHaveBeenCalledTimes(1);
  });

  it("caps exceptions globally when every fingerprint is unique", async () => {
    const { posthog, service } = createHarness();
    await service.initialize();

    for (let i = 0; i < 30; i++) {
      service.captureException(`unique failure ${i}`);
    }
    expect(posthog.captureException).toHaveBeenCalledTimes(20);
  });

  it("holds the bucket map at its hard bound during a unique-key storm", async () => {
    const { posthog, service } = createHarness();
    await service.initialize();

    for (let i = 0; i < 600; i++) {
      service.captureException(`storm ${i}`);
    }
    const buckets = (
      service as unknown as { rateBuckets: Map<string, unknown> }
    ).rateBuckets;
    expect(buckets.size).toBeLessThanOrEqual(500);
    expect(posthog.captureException).toHaveBeenCalledTimes(20);

    vi.advanceTimersByTime(61_000);
    service.captureException("after the storm");
    expect(buckets.size).toBeLessThan(10);
    expect(posthog.captureException).toHaveBeenCalledTimes(21);
  });

  it("never rate-limits the fatal capture-and-shutdown path", async () => {
    const { posthog, service } = createHarness();
    await service.initialize();

    for (let i = 0; i < 30; i++) {
      service.captureException(`noise ${i}`);
    }
    expect(posthog.captureException).toHaveBeenCalledTimes(20);

    await service.captureExceptionImmediateAndShutdown(new Error("fatal"));
    expect(posthog.captureExceptionImmediate).toHaveBeenCalledTimes(1);
  });
});
