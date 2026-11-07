import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportAudioContextFailure,
  reportAudioContextRecovery,
} from "@/hooks/audioCaptureTelemetry";
import { captureRendererException } from "@/renderer/lib/posthog";
import { AudioCaptureTimings } from "@/hooks/audioCaptureTimings";

vi.mock("@/renderer/lib/posthog", () => ({
  captureRendererException: vi.fn(),
}));

describe("audio capture telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("preserves the original failure and adds capture context", () => {
    const timings = new AudioCaptureTimings();
    const error = new Error("resume failed");
    const properties = {
      error_context: "audio_context_failure",
      operation: "resume",
      context_state: "suspended",
      session_id: "session-1",
    };
    reportAudioContextFailure(
      error,
      "resume",
      { state: "suspended" },
      "session-1",
      timings,
    );
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "AudioCapture: AudioContext operation failed",
      properties,
      error,
    );
    expect(captureRendererException).toHaveBeenCalledExactlyOnceWith(
      error,
      properties,
    );
    expect(timings.takeBatch().audioContext).toMatchObject({
      failureOperation: "resume",
      failureState: "suspended",
    });
  });

  it("reports constructor failures before a context exists", () => {
    const error = new Error("audio unavailable");
    reportAudioContextFailure(error, "create", undefined, "session-1");
    expect(captureRendererException).toHaveBeenCalledExactlyOnceWith(error, {
      error_context: "audio_context_failure",
      operation: "create",
      context_state: undefined,
      session_id: "session-1",
    });
  });

  it("adds recovery to the capture summary without creating exceptions", () => {
    const timings = new AudioCaptureTimings();
    reportAudioContextRecovery(
      { state: "suspended" },
      "session-1",
      "started",
      timings,
    );
    reportAudioContextRecovery(
      { state: "running" },
      "session-1",
      "succeeded",
      timings,
      80,
    );
    expect(timings.takeBatch().audioContext).toEqual({
      recoveryAttemptCount: 1,
      recoverySuccessCount: 1,
      recoveryFailureCount: 0,
      recoveryDurationMs: 80,
    });
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(captureRendererException).not.toHaveBeenCalled();
  });
});
