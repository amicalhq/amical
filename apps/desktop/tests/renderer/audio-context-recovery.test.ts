import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCaptureTimings } from "@/hooks/audioCaptureTimings";
import { monitorAudioContextRecovery } from "@/hooks/audioContextRecovery";
import {
  reportAudioContextFailure,
  reportAudioContextRecovery,
} from "@/hooks/audioCaptureTelemetry";

vi.mock("@/hooks/audioCaptureTelemetry", () => ({
  reportAudioContextFailure: vi.fn(),
  reportAudioContextRecovery: vi.fn(),
}));

class FakeAudioContext extends EventTarget {
  state: AudioContextState = "running";
  resume = vi.fn(async () => {
    this.changeState("running");
  });

  changeState(state: AudioContextState): void {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

describe("active AudioContext recovery", () => {
  let timings: AudioCaptureTimings;
  beforeEach(() => {
    vi.clearAllMocks();
    timings = new AudioCaptureTimings();
  });
  afterEach(() => vi.restoreAllMocks());

  it("recovers a suspension once and measures its outcome", async () => {
    const context = new FakeAudioContext();
    const onFailure = vi.fn();
    const pending = Promise.withResolvers<void>();
    context.resume.mockReturnValueOnce(pending.promise);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      onFailure,
      timings,
    );
    expect(reportAudioContextRecovery).not.toHaveBeenCalled();

    context.changeState("suspended");
    context.changeState("suspended");
    expect(context.resume).toHaveBeenCalledOnce();
    expect(reportAudioContextRecovery).toHaveBeenCalledExactlyOnceWith(
      context,
      "session-1",
      "started",
      timings,
    );

    now = 125;
    context.changeState("running");
    pending.resolve();
    await pending.promise;
    expect(reportAudioContextRecovery).toHaveBeenLastCalledWith(
      context,
      "session-1",
      "succeeded",
      timings,
      125,
    );
    expect(reportAudioContextFailure).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    stop();
  });

  it("can recover a later distinct suspension", async () => {
    const context = new FakeAudioContext();
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      vi.fn(),
      timings,
    );
    context.changeState("suspended");
    await Promise.resolve();
    context.changeState("suspended");
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(reportAudioContextRecovery).toHaveBeenCalledTimes(4);
    stop();
  });

  it("handles a context already suspended when monitoring starts", async () => {
    const context = new FakeAudioContext();
    context.state = "suspended";
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      vi.fn(),
      timings,
    );
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(reportAudioContextRecovery).toHaveBeenLastCalledWith(
      context,
      "session-1",
      "succeeded",
      timings,
      expect.any(Number),
    );
    stop();
  });

  it("reports a rejected recovery once and stops further attempts", async () => {
    const context = new FakeAudioContext();
    const onFailure = vi.fn();
    const error = new Error("output unavailable");
    context.resume.mockRejectedValueOnce(error);
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      onFailure,
      timings,
    );
    context.changeState("suspended");
    await Promise.resolve();
    context.changeState("suspended");
    context.changeState("closed");
    expect(context.resume).toHaveBeenCalledOnce();
    expect(reportAudioContextRecovery).toHaveBeenLastCalledWith(
      context,
      "session-1",
      "failed",
      timings,
      expect.any(Number),
    );
    expect(reportAudioContextFailure).toHaveBeenCalledExactlyOnceWith(
      error,
      "recover",
      context,
      "session-1",
      timings,
    );
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(error);
    stop();
  });

  it("fails when resume resolves but the context remains suspended", async () => {
    const context = new FakeAudioContext();
    const onFailure = vi.fn();
    context.resume.mockResolvedValueOnce(undefined);
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      onFailure,
      timings,
    );
    context.changeState("suspended");
    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      new Error("AudioContext did not resume during capture"),
    );
    expect(reportAudioContextFailure).toHaveBeenCalledOnce();
    stop();
  });

  it("reports unexpected closure without trying to resume", () => {
    const context = new FakeAudioContext();
    const onFailure = vi.fn();
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      onFailure,
      timings,
    );
    context.changeState("closed");
    context.changeState("closed");
    expect(context.resume).not.toHaveBeenCalled();
    expect(reportAudioContextFailure).toHaveBeenCalledExactlyOnceWith(
      new Error("AudioContext closed unexpectedly during capture"),
      "unexpected-close",
      context,
      "session-1",
      timings,
    );
    expect(onFailure).toHaveBeenCalledOnce();
    stop();
  });

  it("reports closure during recovery once when resume later rejects", async () => {
    const context = new FakeAudioContext();
    const pending = Promise.withResolvers<void>();
    const onFailure = vi.fn();
    context.resume.mockReturnValueOnce(pending.promise);
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      onFailure,
      timings,
    );
    context.changeState("suspended");
    context.changeState("closed");
    pending.reject(new Error("context closed"));
    await pending.promise.catch(() => undefined);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(reportAudioContextFailure).toHaveBeenCalledOnce();
    expect(reportAudioContextRecovery).toHaveBeenCalledTimes(2);
    expect(reportAudioContextRecovery).toHaveBeenLastCalledWith(
      context,
      "session-1",
      "failed",
      timings,
      expect.any(Number),
    );
    stop();
  });

  it.each(["resolve", "reject"])(
    "ignores a recovery that settles after cleanup (%s)",
    async (result) => {
      const context = new FakeAudioContext();
      const pending = Promise.withResolvers<void>();
      const onFailure = vi.fn();
      context.resume.mockReturnValueOnce(pending.promise);
      const stop = monitorAudioContextRecovery(
        context,
        "session-1",
        onFailure,
        timings,
      );
      context.changeState("suspended");
      stop();
      context.changeState("closed");
      if (result === "resolve") pending.resolve();
      else pending.reject(new Error("context closed"));
      await pending.promise.catch(() => undefined);
      expect(reportAudioContextRecovery).toHaveBeenCalledOnce();
      expect(reportAudioContextFailure).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    },
  );

  it("removes the listener before intentional teardown", () => {
    const context = new FakeAudioContext();
    const remove = vi.spyOn(context, "removeEventListener");
    const onFailure = vi.fn();
    const stop = monitorAudioContextRecovery(
      context,
      "session-1",
      onFailure,
      timings,
    );
    stop();
    context.changeState("suspended");
    context.changeState("closed");
    expect(remove).toHaveBeenCalledExactlyOnceWith(
      "statechange",
      expect.any(Function),
    );
    expect(context.resume).not.toHaveBeenCalled();
    expect(reportAudioContextRecovery).not.toHaveBeenCalled();
    expect(reportAudioContextFailure).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
