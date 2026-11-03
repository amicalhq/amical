import { describe, expect, it } from "vitest";
import {
  CURRENT_SETTINGS_VERSION,
  migrateSettings,
} from "../../src/db/settings-migrations";
import { migrateToV16 } from "../../src/db/settings-migrations/v16";

const completedOnboarding = {
  completedVersion: 1,
  completedAt: "2026-01-01T00:00:00.000Z",
  selectedModelType: "local" as const,
};

describe("migrateToV16", () => {
  it("keeps telemetry on for installs that finished onboarding", () => {
    expect(migrateToV16({ onboarding: completedOnboarding }).telemetry).toEqual(
      { enabled: true },
    );
  });

  it("keeps telemetry on for signed-in installs still in onboarding", () => {
    expect(
      migrateToV16({
        auth: {
          isAuthenticated: true,
          idToken: null,
          refreshToken: null,
          accessToken: null,
          expiresAt: null,
        },
      }).telemetry,
    ).toEqual({ enabled: true });
  });

  it("leaves anonymous installs still in onboarding undecided", () => {
    expect(migrateToV16({ ui: { theme: "dark" } })).toEqual({
      ui: { theme: "dark" },
    });
  });

  it("keeps an explicit choice", () => {
    expect(
      migrateToV16({
        onboarding: completedOnboarding,
        telemetry: { enabled: false },
      }).telemetry,
    ).toEqual({ enabled: false });
  });

  it("is registered as the current migration", () => {
    expect(CURRENT_SETTINGS_VERSION).toBe(16);
    expect(
      migrateSettings({ onboarding: completedOnboarding }, 15).telemetry,
    ).toEqual({ enabled: true });
  });
});
