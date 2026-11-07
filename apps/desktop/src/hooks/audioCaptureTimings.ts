import type {
  AudioContextOperation,
  AudioContextTelemetry,
  CapturePhaseName,
  CaptureTimingsBatch,
} from "@/types/capture-timings";

/** One capture's phase measurements and cumulative context incident summary. */
export class AudioCaptureTimings {
  private phases: CaptureTimingsBatch["phases"] = [];
  private firstFrameFinish: (() => void) | undefined;
  private audioContext: AudioContextTelemetry | undefined;

  private contextSummary(): AudioContextTelemetry {
    return (this.audioContext ??= {
      recoveryAttemptCount: 0,
      recoverySuccessCount: 0,
      recoveryFailureCount: 0,
      recoveryDurationMs: 0,
    });
  }

  recordAudioContextRecovery(
    outcome: "started" | "succeeded" | "failed",
    durationMs = 0,
  ): void {
    const summary = this.contextSummary();
    if (outcome === "started") summary.recoveryAttemptCount++;
    else if (outcome === "succeeded") summary.recoverySuccessCount++;
    else summary.recoveryFailureCount++;
    summary.recoveryDurationMs += durationMs;
  }

  recordAudioContextFailure(
    operation: AudioContextOperation,
    state?: string,
  ): void {
    const summary = this.contextSummary();
    summary.failureOperation = operation;
    summary.failureState = state;
  }

  start(name: CapturePhaseName): () => void {
    const startedAtMs = Date.now();
    const startedAtMonotonicMs = performance.now();
    return () => {
      this.phases.push({
        name,
        startedAtMs,
        durationMs: performance.now() - startedAtMonotonicMs,
      });
    };
  }

  async measure<T>(
    name: CapturePhaseName,
    operation: () => Promise<T>,
  ): Promise<T> {
    const finish = this.start(name);
    const result = await operation();
    finish();
    return result;
  }

  startFirstFrameWait(): void {
    this.firstFrameFinish = this.start("capture.first-frame-wait");
  }

  finishFirstFrameWait(): void {
    this.firstFrameFinish?.();
    this.firstFrameFinish = undefined;
  }

  takeBatch(): CaptureTimingsBatch {
    const phases = this.phases;
    this.phases = [];
    return {
      phases,
      ...(this.audioContext && { audioContext: { ...this.audioContext } }),
    };
  }
}
