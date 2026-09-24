import {
  reportAudioContextFailure,
  reportAudioContextRecovery,
} from "./audioCaptureTelemetry";
import type { AudioCaptureTimings } from "./audioCaptureTimings";

/** Observe only while this context belongs to an active capture session. */
export function monitorAudioContextRecovery(
  audioContext: Pick<AudioContext, "state" | "resume"> & EventTarget,
  sessionId: string,
  onFailure: (error: unknown) => void,
  timings: AudioCaptureTimings,
): () => void {
  let active = true;
  let failed = false;
  let recoveryStartedAt: number | null = null;

  const fail = (error: unknown, operation: "recover" | "unexpected-close") => {
    if (!active || failed) return;
    failed = true;
    if (recoveryStartedAt !== null) {
      reportAudioContextRecovery(
        audioContext,
        sessionId,
        "failed",
        timings,
        performance.now() - recoveryStartedAt,
      );
    }
    reportAudioContextFailure(
      error,
      operation,
      audioContext,
      sessionId,
      timings,
    );
    onFailure(error);
  };

  const onStateChange = () => {
    if (!active || failed) return;
    if (audioContext.state === "closed") {
      fail(
        new Error("AudioContext closed unexpectedly during capture"),
        "unexpected-close",
      );
      return;
    }
    if (audioContext.state !== "suspended" || recoveryStartedAt !== null)
      return;

    const startedAt = performance.now();
    recoveryStartedAt = startedAt;
    reportAudioContextRecovery(audioContext, sessionId, "started", timings);
    void (async () => {
      try {
        await audioContext.resume();
        if (!active || failed) return;
        if (audioContext.state !== "running") {
          throw new Error("AudioContext did not resume during capture");
        }
        reportAudioContextRecovery(
          audioContext,
          sessionId,
          "succeeded",
          timings,
          performance.now() - startedAt,
        );
      } catch (error) {
        fail(error, "recover");
      } finally {
        recoveryStartedAt = null;
      }
    })();
  };

  audioContext.addEventListener("statechange", onStateChange);
  onStateChange();

  return () => {
    active = false;
    audioContext.removeEventListener("statechange", onStateChange);
  };
}
