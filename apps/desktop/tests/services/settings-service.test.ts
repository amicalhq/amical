import { describe, it, expect, vi } from "vitest";

// Isolate the service from the real database layer.
vi.mock("../../src/db/app-settings", () => ({
  getSettingsSection: vi.fn().mockResolvedValue(undefined),
  updateSettingsSection: vi.fn().mockResolvedValue(undefined),
  getAppSettings: vi.fn().mockResolvedValue({}),
  updateAppSettings: vi.fn().mockResolvedValue({}),
}));

import { SettingsService } from "../../src/services/settings-service";

describe("SettingsService", () => {
  it("emits 'recording-settings-changed' when recording settings are saved", async () => {
    const service = new SettingsService();
    const listener = vi.fn();
    service.on("recording-settings-changed", listener);

    const recordingSettings = {
      defaultFormat: "wav" as const,
      sampleRate: 16000 as const,
      autoStopSilence: false,
      silenceThreshold: 0.1,
      maxRecordingDuration: 300,
      preferredMicrophoneName: "USB Microphone",
    };

    await service.setRecordingSettings(recordingSettings);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(recordingSettings);
  });
});
