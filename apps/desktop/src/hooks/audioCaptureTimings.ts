import type {
  CapturePhaseName,
  CaptureTimingsBatch,
} from "@/types/capture-timings";

/** One capture's bounded phase measurements: epoch starts, monotonic durations. */
export class AudioCaptureTimings {
  private phases: CaptureTimingsBatch["phases"] = [];
  private firstFrameFinish: (() => void) | undefined;

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
    return { phases };
  }
}
