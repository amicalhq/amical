// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Module boundaries we don't want to pull into the test ──────────────────────
// "@/trpc/react" is aliased to a stub in vitest.config (it would otherwise drag in
// @trpc/react-query + electron IPC). Here we stub the worklet asset URL, the
// diagnostics logger, and the recycle-delay math (tested in audio-capture-recycle).
vi.mock("@/assets/audio-recorder-processor.js?url", () => ({
  default: "test-worklet-url",
}));
vi.mock("@/hooks/audioCaptureDiagnostics", () => ({
  audioCaptureDiagnostics: {
    logEnumerateDevicesTiming: vi.fn(),
    logAudioInputDevices: vi.fn(),
    logPreferredDeviceResolution: vi.fn(),
    logTrackState: vi.fn(),
    logDeviceChange: vi.fn(),
    logDeviceEnumerationFailure: vi.fn(),
    registerTrack: vi.fn(() => vi.fn()),
  },
}));
// Recycle quickly so the idle timer fires within the test instead of after 5 min.
vi.mock("@/hooks/audioCaptureRecycle", () => ({
  AUDIO_CONTEXT_IDLE_TIMEOUT_MS: 5,
  AUDIO_CONTEXT_MAX_AGE_MS: 10,
  computeIdleRecycleDelayMs: () => 5,
}));

import { useAudioCapture } from "@/hooks/useAudioCapture";
import type { CaptureFailure } from "@/types/recording";
import { api } from "@/trpc/react";

// ── Web Audio fakes ────────────────────────────────────────────────────────────
interface FakeTrack extends EventTarget {
  kind: string;
  stop: ReturnType<typeof vi.fn>;
}
interface FakeStream {
  getAudioTracks: () => FakeTrack[];
  getTracks: () => FakeTrack[];
  track: FakeTrack;
}

let audioContexts: FakeAudioContext[] = [];
let workletNodes: FakeWorkletNode[] = [];
let sources: FakeSourceNode[] = [];
let analysers: FakeAnalyserNode[] = [];
let streams: FakeStream[] = [];

class FakeSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    sources.push(this);
  }
}

class FakeAnalyserNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
  minDecibels = 0;
  maxDecibels = 0;
  connect = vi.fn();
  disconnect = vi.fn();
  getByteFrequencyData = vi.fn();
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  constructor() {
    analysers.push(this);
  }
}

class FakeWorkletNode {
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: (msg: { type: string }) => void;
  };
  constructor(
    public context: FakeAudioContext,
    public name: string,
    public options: AudioWorkletNodeOptions,
  ) {
    workletNodes.push(this);
    this.port = {
      onmessage: null,
      // Simulate the real worklet: on flush, echo back a final audioFrame so the
      // renderer's waitForWorkletFlush resolves and stopCapture can suspend.
      postMessage: (msg) => {
        if (msg?.type === "flush") {
          queueMicrotask(() =>
            this.port.onmessage?.({
              data: {
                type: "audioFrame",
                frame: new Float32Array(0),
                isFinal: true,
              },
            }),
          );
        }
      },
    };
  }
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  createMediaStreamSource = vi.fn(() => new FakeSourceNode());
  createAnalyser = vi.fn(() => new FakeAnalyserNode());
  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor(public options: unknown) {
    audioContexts.push(this);
  }
}

function makeStream(): FakeStream {
  const track: FakeTrack = Object.assign(new EventTarget(), {
    kind: "audio",
    stop: vi.fn(),
  });
  const stream: FakeStream = {
    track,
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  streams.push(stream);
  return stream;
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  audioContexts = [];
  workletNodes = [];
  sources = [];
  analysers = [];
  streams = [];
  getUserMedia = vi.fn(async () => makeStream());

  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
  (globalThis as Record<string, unknown>).AudioWorkletNode = FakeWorkletNode;
  // mediaDevices without addEventListener: the device-change diagnostics effect
  // bails on `!navigator.mediaDevices?.addEventListener`, so we skip that path.
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => []),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).AudioWorkletNode;
});

// Let the effect-driven async start/stop bodies (mutex + getUserMedia/addModule/
// resume/suspend + the flush microtask) settle.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

interface AudioCaptureHookProps {
  enabled: boolean;
  idle: boolean;
  sessionId: string | null;
}

function mountHook() {
  const onAudioChunk = vi.fn();
  const onCaptureStarted = vi.fn();
  const onCaptureFailure = vi.fn<(failure: CaptureFailure) => void>();
  const initialProps: AudioCaptureHookProps = {
    enabled: false,
    idle: true,
    sessionId: null,
  };
  const view = renderHook(
    ({ enabled, idle, sessionId }: AudioCaptureHookProps) =>
      useAudioCapture({
        onAudioChunk,
        onCaptureStarted,
        onCaptureFailure,
        sessionId,
        enabled,
        idle,
      }),
    { initialProps },
  );
  return { onAudioChunk, onCaptureStarted, onCaptureFailure, ...view };
}

describe("useAudioCapture lifecycle", () => {
  it("snapshots the remote control per capture without restarting an active graph", async () => {
    const query = vi.spyOn(api.useUtils().client.remoteConfig.get, "query");
    query.mockResolvedValue({
      flags: { "desktop-stereo-mic-downmix": true },
    } as never);
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(workletNodes[0].options).toEqual({
      channelCountMode: "max",
      channelInterpretation: "discrete",
      processorOptions: { stereoDownmixEnabled: true },
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        deviceId: { exact: "default" },
      },
    });
    query.mockResolvedValue({
      flags: { "desktop-stereo-mic-downmix": false },
    } as never);
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(workletNodes).toHaveLength(1);
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(workletNodes[1].options.processorOptions).toEqual({
      stereoDownmixEnabled: false,
    });
  });

  it("does not open the mic after unmount while waiting for config", async () => {
    const query = vi.spyOn(api.useUtils().client.remoteConfig.get, "query");
    const pendingConfig =
      Promise.withResolvers<Awaited<ReturnType<typeof query>>>();
    query.mockReturnValueOnce(pendingConfig.promise);
    const { rerender, unmount } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(query).toHaveBeenCalledOnce();
    unmount();
    pendingConfig.resolve({
      flags: { "desktop-stereo-mic-downmix": true },
    } as never);
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(workletNodes).toHaveLength(0);
  });

  it("falls back to first-channel capture if the config IPC read fails", async () => {
    vi.spyOn(api.useUtils().client.remoteConfig.get, "query").mockRejectedValue(
      new Error("IPC unavailable"),
    );
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(workletNodes[0].options.processorOptions).toEqual({
      stereoDownmixEnabled: false,
    });
  });

  it("forwards observed channels on the first frame and format changes, including a short final frame", async () => {
    getUserMedia.mockImplementation(async () => {
      const stream = makeStream();
      Object.assign(stream.track, { getSettings: () => ({ channelCount: 2 }) });
      return stream;
    });
    const { rerender, onAudioChunk } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const send = (inputChannelCount: number, isFinal = false) =>
      act(async () => {
        workletNodes[0].port.onmessage?.({
          data: {
            type: "audioFrame",
            frame: new Float32Array(32),
            isFinal,
            inputChannelCount,
          },
        });
      });
    await send(2);
    await send(2);
    await send(1, true);
    expect(onAudioChunk.mock.calls.map((call) => call[4])).toEqual([
      {
        inputChannelCount: 2,
        trackChannelCount: 2,
        stereoDownmixEnabled: true,
      },
      undefined,
      {
        inputChannelCount: 1,
        trackChannelCount: 2,
        stereoDownmixEnabled: true,
      },
    ]);
  });

  it("I-55 reports a microphone start failure with its original cause", async () => {
    const failure = new DOMException("Permission denied", "NotAllowedError");
    getUserMedia.mockRejectedValueOnce(failure);
    const { onCaptureFailure, rerender } = mountHook();

    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();

    expect(onCaptureFailure).toHaveBeenCalledOnce();
    expect(onCaptureFailure).toHaveBeenCalledWith({
      sessionId: "session-1",
      name: "NotAllowedError",
      message: "Permission denied",
    });
    expect(audioContexts).toHaveLength(0);
  });

  it("I-55 ignores a capture failure from a replaced session", async () => {
    const pendingMicrophone = Promise.withResolvers<FakeStream>();
    getUserMedia.mockReturnValueOnce(pendingMicrophone.promise);
    const { onCaptureFailure, rerender } = mountHook();

    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledOnce();

    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    pendingMicrophone.reject(
      new DOMException("Permission dismissed", "NotAllowedError"),
    );
    await settle();

    expect(onCaptureFailure).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("opens the mic and wires source -> worklet on start", async () => {
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(workletNodes).toHaveLength(1);
    // source connected to the worklet node
    expect(sources[0].connect).toHaveBeenCalledWith(workletNodes[0]);
    // and tapped by an analyser for the waveform visualiser
    expect(analysers).toHaveLength(1);
    expect(sources[0].connect).toHaveBeenCalledWith(analysers[0]);
  });

  it("I-54 keeps delayed capture callbacks bound to their original session", async () => {
    const { onAudioChunk, onCaptureStarted, rerender } = mountHook();

    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const retiredFrameHandler = workletNodes[0].port.onmessage;

    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    await settle();

    expect(onCaptureStarted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ captureSource: "default" }),
      "session-1",
    );
    expect(onCaptureStarted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ captureSource: "default" }),
      "session-2",
    );

    onAudioChunk.mockClear();
    await act(async () => {
      retiredFrameHandler?.({
        data: {
          type: "audioFrame",
          frame: new Float32Array([0.1]),
          isFinal: false,
        },
      });
      await Promise.resolve();
    });

    expect(onAudioChunk).toHaveBeenCalledWith(
      "session-1",
      expect.any(ArrayBuffer),
      0,
      false,
      undefined,
    );
  });

  it("keeps the AudioContext warm across dictations but creates a fresh worklet node each time", async () => {
    const { rerender } = mountHook();

    // First dictation.
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    // Stop WITHOUT going idle (transient), so the context is suspended, not recycled.
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();

    expect(audioContexts[0].suspend).toHaveBeenCalled();
    expect(audioContexts[0].state).toBe("suspended");
    // The source is fully disconnected on stop, so its worklet + analyser-tap
    // edges don't accumulate on the retained warm context.
    expect(sources[0].disconnect).toHaveBeenCalledWith();

    // Second dictation reuses the same (warm) context.
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();

    // Warm reuse: no new AudioContext, no second addModule, context resumed.
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(audioContexts[0].resume).toHaveBeenCalled();
    // Fresh worklet node + analyser per dictation (no stale buffer can survive).
    expect(workletNodes).toHaveLength(2);
    expect(analysers).toHaveLength(2);
  });

  it("stops the mic track on stop while keeping the context for reuse", async () => {
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const track = streams[0].track;

    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();

    expect(track.stop).toHaveBeenCalled();
    expect(audioContexts[0].close).not.toHaveBeenCalled(); // kept warm
  });

  it("recycles (closes) the warm context once idle for the recycle delay", async () => {
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    // Stop and go idle -> idle effect schedules the (mocked-short) recycle timer.
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    // Wait past the 5ms mocked recycle delay.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(audioContexts[0].close).toHaveBeenCalled();
    expect(audioContexts[0].state).toBe("closed");
  });

  it("releases the mic and context on unmount", async () => {
    const { rerender, unmount } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const track = streams[0].track;

    unmount();
    await settle();

    expect(track.stop).toHaveBeenCalled();
    expect(audioContexts[0].close).toHaveBeenCalled();
  });
});
