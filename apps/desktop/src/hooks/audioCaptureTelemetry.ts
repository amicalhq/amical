import { captureRendererException } from "@/renderer/lib/posthog";
import type { AudioContextOperation } from "@/types/capture-timings";
import type { AudioCaptureTimings } from "./audioCaptureTimings";

export function reportAudioContextFailure(
  error: unknown,
  operation: AudioContextOperation,
  audioContext?: Pick<AudioContext, "state">,
  sessionId?: string,
  timings?: AudioCaptureTimings,
): void {
  timings?.recordAudioContextFailure(operation, audioContext?.state);
  const properties = {
    error_context: "audio_context_failure",
    operation,
    context_state: audioContext?.state,
    session_id: sessionId,
  };
  console.error(
    "AudioCapture: AudioContext operation failed",
    properties,
    error,
  );
  captureRendererException(error, properties);
}

export function reportAudioContextRecovery(
  audioContext: Pick<AudioContext, "state">,
  sessionId: string,
  outcome: "started" | "succeeded" | "failed",
  timings: AudioCaptureTimings,
  durationMs?: number,
): void {
  timings.recordAudioContextRecovery(outcome, durationMs);
  const properties = {
    session_id: sessionId,
    context_state: audioContext.state,
    outcome,
    ...(durationMs !== undefined && { duration_ms: durationMs }),
  };
  console.warn(
    "AudioCapture: Unexpected AudioContext interruption",
    properties,
  );
}
