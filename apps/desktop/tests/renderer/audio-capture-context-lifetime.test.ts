import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCaptureContextLifetime } from "@/hooks/audioCaptureContextLifetime";
import { AudioCaptureTimings } from "@/hooks/audioCaptureTimings";
import { AUDIO_CONTEXT_IDLE_TIMEOUT_MS } from "@/hooks/audioCaptureRecycle";
import { reportAudioContextFailure } from "@/hooks/audioCaptureTelemetry";

vi.mock("@/hooks/audioCaptureTelemetry", () => ({
  reportAudioContextFailure: vi.fn(),
}));

let contexts: FakeAudioContext[];
let worklets: FakeAudioWorkletNode[];
let moduleReady: Promise<void>;
let constructorFailure: Error | undefined;
let workletFailure: Error | undefined;
let initialState: AudioContextState;

class FakeAudioContext {
  state = initialState;
  destination = {};
  audioWorklet = { addModule: vi.fn(() => moduleReady) };
  createMediaStreamSource = vi.fn();
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });

  constructor(public options: AudioContextOptions) {
    if (constructorFailure) throw constructorFailure;
    contexts.push(this);
  }
}

class FakeAudioWorkletNode {
  connect = vi.fn();
  disconnect = vi.fn();
  port = { onmessage: null, postMessage: vi.fn() };

  constructor(
    public context: FakeAudioContext,
    public name: string,
    public options: AudioWorkletNodeOptions,
  ) {
    if (workletFailure) throw workletFailure;
    worklets.push(this);
  }
}

let lifetime: AudioCaptureContextLifetime;
const HOUR = AUDIO_CONTEXT_IDLE_TIMEOUT_MS;
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ now: 100_000 });
  vi.clearAllMocks();
  contexts = [];
  worklets = [];
  moduleReady = Promise.resolve();
  constructorFailure = undefined;
  workletFailure = undefined;
  initialState = "running";
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  lifetime = new AudioCaptureContextLifetime(16_000, "test-worklet-url");
});

afterEach(async () => {
  await lifetime.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AudioCaptureContextLifetime", () => {
  it("prepares one silent graph without microphone acquisition and reuses it", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const prepared = await lifetime.prepare();
    const timings = new AudioCaptureTimings();
    expect(await lifetime.prepare(timings, "session-1")).toEqual(prepared);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].options).toEqual({
      sampleRate: 16_000,
      latencyHint: "interactive",
    });
    expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledExactlyOnceWith(
      "test-worklet-url",
    );
    expect(contexts[0].createMediaStreamSource).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(worklets).toHaveLength(1);
    expect(worklets[0].connect).toHaveBeenCalledExactlyOnceWith(
      contexts[0].destination,
    );
    expect(worklets[0].port.postMessage).not.toHaveBeenCalled();
    expect(timings.takeBatch().phases).toEqual([]);
    expect(lifetime.audioContext).toBe(prepared.audioContext);
    expect(lifetime.workletNode).toBe(prepared.workletNode);
  });

  it("records cold capture setup and resumes a newly suspended context", async () => {
    initialState = "suspended";
    const timings = new AudioCaptureTimings();
    await lifetime.prepare(timings, "session-1");
    expect(contexts[0].resume).toHaveBeenCalledOnce();
    expect(contexts[0].state).toBe("running");
    expect(timings.takeBatch().phases.map((phase) => phase.name)).toEqual([
      "capture.audio-context-create",
      "capture.audio-context-resume",
    ]);
  });

  it("anchors the initial idle deadline after module preparation finishes", async () => {
    const pending = Promise.withResolvers<void>();
    moduleReady = pending.promise;
    const preparing = lifetime.prepare();
    await vi.advanceTimersByTimeAsync(30_000);
    pending.resolve();
    await preparing;
    const expired = vi.fn();
    lifetime.scheduleIdleClose(expired);
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(expired).not.toHaveBeenCalled();
    expect(lifetime.isIdleExpired()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledOnce();
    expect(lifetime.isIdleExpired()).toBe(true);
  });

  it("does not extend the idle deadline when scheduling again", async () => {
    await lifetime.prepare();
    const expired = vi.fn();
    lifetime.scheduleIdleClose(expired);
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    lifetime.scheduleIdleClose(expired);
    await vi.advanceTimersByTimeAsync(30 * MINUTE - 1);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("resets the deadline after cleanup and preserves it across replacement", async () => {
    await lifetime.prepare();
    const startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(8 * MINUTE);
    expect(lifetime.finishAttempt(startedAt)).toBe(true);
    await lifetime.close();
    await vi.advanceTimersByTimeAsync(30_000);
    await lifetime.prepare();
    expect(contexts).toHaveLength(2);
    const expired = vi.fn();
    lifetime.scheduleIdleClose(expired);
    await vi.advanceTimersByTimeAsync(HOUR - 30_001);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledOnce();
  });

  it("does not replace an old context after a short attempt", async () => {
    await lifetime.prepare();
    await vi.advanceTimersByTimeAsync(8 * MINUTE);
    expect(lifetime.finishAttempt(Date.now() - 5_000)).toBe(false);
    expect(lifetime.audioContext).toBe(contexts[0]);
    expect(contexts[0].close).not.toHaveBeenCalled();
    const expired = vi.fn();
    lifetime.scheduleIdleClose(expired);
    await vi.advanceTimersByTimeAsync(8 * MINUTE);
    expect(expired).not.toHaveBeenCalled();
  });

  it("cancels idle closure and does not schedule an absent graph", async () => {
    const expired = vi.fn();
    lifetime.scheduleIdleClose(expired);
    expect(vi.getTimerCount()).toBe(0);
    await lifetime.prepare();
    lifetime.scheduleIdleClose(expired);
    lifetime.cancelIdleClose();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(expired).not.toHaveBeenCalled();
    await lifetime.close();
    expect(lifetime.audioContext).toBeNull();
    expect(lifetime.workletNode).toBeNull();
    expect(worklets[0].disconnect).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(lifetime.finishAttempt(Date.now() - 10_000)).toBe(false);
  });

  it("replaces an externally closed context and its worklet", async () => {
    await lifetime.prepare();
    contexts[0].state = "closed";
    await lifetime.prepare();
    expect(contexts).toHaveLength(2);
    expect(worklets).toHaveLength(2);
    expect(worklets[0].disconnect).toHaveBeenCalledOnce();
    expect(lifetime.audioContext).toBe(contexts[1]);
    expect(worklets[1].context).toBe(contexts[1]);
  });

  it("retires a context after module failure and allows a later preparation", async () => {
    const pending = Promise.withResolvers<void>();
    moduleReady = pending.promise;
    const preparing = lifetime.prepare();
    const failed = expect(preparing).rejects.toThrow("module unavailable");
    pending.reject(new Error("module unavailable"));
    await failed;
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(lifetime.audioContext).toBeNull();
    expect(lifetime.workletNode).toBeNull();
    expect(reportAudioContextFailure).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      "worklet-load",
      contexts[0],
      undefined,
      undefined,
    );
    moduleReady = Promise.resolve();
    await lifetime.prepare();
    expect(contexts).toHaveLength(2);
    expect(worklets).toHaveLength(1);
  });

  it("retires the context and reports once if worklet creation fails", async () => {
    workletFailure = new Error("processor unavailable");
    await expect(lifetime.prepare()).rejects.toThrow("processor unavailable");
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(lifetime.audioContext).toBeNull();
    expect(lifetime.workletNode).toBeNull();
    expect(reportAudioContextFailure).toHaveBeenCalledExactlyOnceWith(
      workletFailure,
      "graph-setup",
      contexts[0],
      undefined,
      undefined,
    );
  });

  it("retires the existing graph if resume fails", async () => {
    await lifetime.prepare();
    contexts[0].state = "suspended";
    const failure = new Error("resume unavailable");
    contexts[0].resume.mockRejectedValueOnce(failure);
    await expect(lifetime.prepare(undefined, "session-2")).rejects.toThrow(
      "resume unavailable",
    );
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(worklets[0].disconnect).toHaveBeenCalledOnce();
    expect(lifetime.audioContext).toBeNull();
    expect(lifetime.workletNode).toBeNull();
    expect(reportAudioContextFailure).toHaveBeenCalledExactlyOnceWith(
      failure,
      "resume",
      contexts[0],
      "session-2",
      undefined,
    );
  });

  it("reports constructor failure without retaining resources", async () => {
    constructorFailure = new Error("context unavailable");
    await expect(lifetime.prepare()).rejects.toThrow("context unavailable");
    expect(contexts).toHaveLength(0);
    expect(lifetime.audioContext).toBeNull();
    expect(lifetime.workletNode).toBeNull();
    expect(reportAudioContextFailure).toHaveBeenCalledExactlyOnceWith(
      constructorFailure,
      "create",
      undefined,
      undefined,
      undefined,
    );
  });
});
