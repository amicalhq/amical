import {
  createAudioCaptureWorklet,
  createOrResumeAudioContext,
} from "./audioCaptureContext";
import {
  AUDIO_CONTEXT_IDLE_TIMEOUT_MS,
  shouldRecycleAudioContext,
} from "./audioCaptureRecycle";
import type { AudioCaptureTimings } from "./audioCaptureTimings";

/** Owns the reusable graph. The capture mutex serializes prepare and close. */
export class AudioCaptureContextLifetime {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private createdAtMs = 0;
  private idleDeadlineMs: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sampleRate: number,
    private readonly audioWorkletUrl: string,
  ) {}

  get audioContext(): AudioContext | null {
    return this.context;
  }

  get workletNode(): AudioWorkletNode | null {
    return this.worklet;
  }

  async prepare(
    timings?: AudioCaptureTimings,
    sessionId?: string,
  ): Promise<{ audioContext: AudioContext; workletNode: AudioWorkletNode }> {
    try {
      if (this.context?.state === "closed") await this.close();
      const { audioContext, createdAt } = await createOrResumeAudioContext({
        currentAudioContext: this.context,
        sampleRate: this.sampleRate,
        audioWorkletUrl: this.audioWorkletUrl,
        timings,
        sessionId,
      });
      this.context = audioContext;
      if (createdAt !== undefined) this.createdAtMs = createdAt;
      this.worklet ??= createAudioCaptureWorklet(
        audioContext,
        sessionId,
        timings,
      );
      this.idleDeadlineMs ??= Date.now() + AUDIO_CONTEXT_IDLE_TIMEOUT_MS;
      return { audioContext, workletNode: this.worklet };
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.cancelIdleClose();
    const context = this.context;
    const worklet = this.worklet;
    this.context = null;
    this.worklet = null;
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.disconnect();
    }
    if (context && context.state !== "closed") {
      await context.close().catch(() => {});
    }
  }

  finishAttempt(startedAtMs: number, endedAtMs = Date.now()): boolean {
    this.idleDeadlineMs = endedAtMs + AUDIO_CONTEXT_IDLE_TIMEOUT_MS;
    return (
      this.context?.state === "running" &&
      this.worklet !== null &&
      shouldRecycleAudioContext(
        endedAtMs - this.createdAtMs,
        endedAtMs - startedAtMs,
      )
    );
  }

  cancelIdleClose(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  scheduleIdleClose(onExpired: () => void): void {
    this.cancelIdleClose();
    if (!this.context || this.idleDeadlineMs === null) return;
    this.idleTimer = setTimeout(
      () => {
        this.idleTimer = null;
        // The timer is monotonic; the deadline is wall-clock. Wait out any lag.
        if (this.isIdleExpired()) onExpired();
        else this.scheduleIdleClose(onExpired);
      },
      Math.max(0, this.idleDeadlineMs - Date.now()),
    );
  }

  isIdleExpired(): boolean {
    return this.idleDeadlineMs !== null && Date.now() >= this.idleDeadlineMs;
  }
}
