import { describe, expect, it } from "vitest";
import {
  buildNotificationDescription,
  getNotificationDescription,
  WIDGET_NOTIFICATION_CONFIG,
} from "../../src/types/widget-notification";

describe("buildNotificationDescription", () => {
  it("returns an explicit uiMessage verbatim, even for mic types", () => {
    expect(
      buildNotificationDescription(
        "no_audio",
        WIDGET_NOTIFICATION_CONFIG.no_audio,
        {
          uiMessage: "Custom message",
          params: { microphone: "External USB Mic" },
        },
      ),
    ).toBe("Custom message");
  });

  it("templates the microphone name for no_audio", () => {
    expect(
      buildNotificationDescription(
        "no_audio",
        WIDGET_NOTIFICATION_CONFIG.no_audio,
        { params: { microphone: "External USB Mic" } },
      ),
    ).toEqual(getNotificationDescription("no_audio", "External USB Mic"));
  });

  it("templates the microphone name for empty_transcript", () => {
    expect(
      buildNotificationDescription(
        "empty_transcript",
        WIDGET_NOTIFICATION_CONFIG.empty_transcript,
        { params: { microphone: "External USB Mic" } },
      ),
    ).toEqual(
      getNotificationDescription("empty_transcript", "External USB Mic"),
    );
  });

  it("falls back to the generic description when no microphone name is present", () => {
    const config = WIDGET_NOTIFICATION_CONFIG.no_audio;
    // No params → the default description, which carries no {{microphone}}
    // placeholder, so no raw template can leak to the toast.
    expect(buildNotificationDescription("no_audio", config, {})).toBe(
      config.description,
    );
  });

  it("does not template mic copy for non-microphone notification types", () => {
    const config = WIDGET_NOTIFICATION_CONFIG.recording_duration_warning;
    const base = config.description;
    if (typeof base === "string") throw new Error("expected an i18n object");
    // A microphone param on a non-mic type is injected, never templated.
    expect(
      buildNotificationDescription("recording_duration_warning", config, {
        params: { microphone: "External USB Mic" },
      }),
    ).toEqual({ ...base, params: { microphone: "External USB Mic" } });
  });

  it("injects params into the default description for parameterized types", () => {
    const config = WIDGET_NOTIFICATION_CONFIG.recording_duration_warning;
    const base = config.description;
    if (typeof base === "string") throw new Error("expected an i18n object");
    expect(
      buildNotificationDescription("recording_duration_warning", config, {
        params: { minutes: 5 },
      }),
    ).toEqual({ ...base, params: { minutes: 5 } });
  });

  it("ignores a non-string microphone param and falls back", () => {
    const config = WIDGET_NOTIFICATION_CONFIG.no_audio;
    const base = config.description;
    if (typeof base === "string") throw new Error("expected an i18n object");
    expect(
      buildNotificationDescription("no_audio", config, {
        params: { microphone: 42 },
      }),
    ).toEqual({ ...base, params: { microphone: 42 } });
  });
});
