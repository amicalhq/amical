import { describe, it, expect } from "vitest";
import { migrateToV13 } from "../../src/db/settings-migrations/v13";

describe("migrateToV13", () => {
  it("converts a legacy pref WITH a deviceId into an id-set chain entry", () => {
    const result = migrateToV13({
      recording: {
        defaultFormat: "wav",
        preferredMicrophoneDeviceId: "abc",
        preferredMicrophoneName: "USB Mic",
      },
    });
    expect(result.recording).toEqual({
      defaultFormat: "wav",
      microphonePriority: [{ deviceId: "abc", name: "USB Mic" }],
    });
  });

  it("stashes a name-only legacy pref as pendingMicrophoneName (no chain entry)", () => {
    const result = migrateToV13({
      recording: { defaultFormat: "wav", preferredMicrophoneName: "USB Mic" },
    });
    expect(result.recording).toEqual({
      defaultFormat: "wav",
      pendingMicrophoneName: "USB Mic",
    });
  });

  it("leaves no preference when there was none (system default)", () => {
    const result = migrateToV13({ recording: { defaultFormat: "wav" } });
    expect(result.recording).toEqual({ defaultFormat: "wav" });
    expect(result.recording).not.toHaveProperty("preferredMicrophoneName");
    expect(result.recording).not.toHaveProperty("microphonePriority");
  });

  it("keeps an existing chain and still strips legacy fields", () => {
    const result = migrateToV13({
      recording: {
        microphonePriority: [{ deviceId: "x", name: "X" }],
        preferredMicrophoneDeviceId: "abc",
        preferredMicrophoneName: "USB Mic",
      },
    });
    expect(result.recording).toEqual({
      microphonePriority: [{ deviceId: "x", name: "X" }],
    });
  });

  it("passes through when there is no recording section", () => {
    const result = migrateToV13({ ui: { theme: "dark" } });
    expect(result).toEqual({ ui: { theme: "dark" } });
  });
});
