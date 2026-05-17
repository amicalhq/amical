import { beforeEach, describe, expect, it, vi } from "vitest";
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
  } as unknown as PostHogClient;

  const settingsService = {
    getTelemetrySettings: vi.fn(() => Promise.resolve({ enabled: true })),
    getAllSettings: vi.fn(() => Promise.resolve({ auth })),
    setTelemetrySettings: vi.fn(() => Promise.resolve()),
  } as unknown as SettingsService;

  return {
    client,
    posthog,
    service: new TelemetryService(client, settingsService),
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
