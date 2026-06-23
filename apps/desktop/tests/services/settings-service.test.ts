import { describe, it, expect, vi } from "vitest";

// Isolate the service from the real database layer.
vi.mock("../../src/db/app-settings", () => ({
  getSettingsSection: vi.fn().mockResolvedValue(undefined),
  updateSettingsSection: vi.fn().mockResolvedValue(undefined),
  getAppSettings: vi.fn().mockResolvedValue({}),
  updateAppSettings: vi.fn().mockResolvedValue({}),
}));

import { SettingsService } from "../../src/services/settings-service";
import {
  getSettingsSection,
  updateSettingsSection,
} from "../../src/db/app-settings";

describe("SettingsService", () => {
  it("defaults labs self correction off when unset", async () => {
    vi.mocked(getSettingsSection).mockResolvedValueOnce(undefined);

    const service = new SettingsService();

    await expect(service.getLabsSettings()).resolves.toEqual({
      selfCorrection: false,
    });
  });

  it("persists labs settings as their own section", async () => {
    const service = new SettingsService();

    await service.setLabsSettings({ selfCorrection: true });

    expect(updateSettingsSection).toHaveBeenCalledWith("labs", {
      selfCorrection: true,
    });
  });

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
      microphonePriority: [{ deviceId: "usb-mic", name: "USB Microphone" }],
    };

    await service.setRecordingSettings(recordingSettings);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(recordingSettings);
  });
});
