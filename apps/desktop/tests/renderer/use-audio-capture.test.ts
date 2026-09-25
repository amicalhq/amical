// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Module boundaries we don't want to pull into the test ──────────────────────
// "@/trpc/react" is aliased to a stub in vitest.config (it would otherwise drag in
// @trpc/react-query + electron IPC). Here we stub the worklet asset URL, the
// diagnostics logger. Lifecycle timers use the actual production policy.
vi.mock("@/assets/audio-recorder-processor.js?url", () => ({
  default: "test-worklet-url",
}));
vi.mock("@/renderer/lib/posthog", () => ({
  captureRendererException: vi.fn(),
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

import {
  useAudioCapture,
  type UseAudioCaptureParams,
} from "@/hooks/useAudioCapture";
import { api } from "@/trpc/react";
import type { CaptureTimingsBatch } from "@/types/capture-timings";
import { DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG } from "@/types/audio-capture";
import { AUDIO_CONTEXT_IDLE_TIMEOUT_MS } from "@/hooks/audioCaptureRecycle";
import { captureRendererException } from "@/renderer/lib/posthog";

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
let graphEvents: string[] = [];

class FakeSourceNode {
  connect = vi.fn((node: unknown) => {
    if (node instanceof FakeWorkletNode) graphEvents.push("source-connect");
  });
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
  connect = vi.fn();
  disconnect = vi.fn();
  messages: Array<{ type: string; stereoDownmixEnabled?: boolean }> = [];
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: (msg: {
      type: string;
      stereoDownmixEnabled?: boolean;
    }) => void;
  };
  constructor(
    public context: FakeAudioContext,
    public name: string,
    public options: AudioWorkletNodeOptions,
  ) {
    workletNodes.push(this);
    this.port = {
      onmessage: null,
      // Simulate the real worklet's final frame on flush.
      postMessage: (msg) => {
        this.messages.push(msg);
        if (msg?.type === "start") graphEvents.push("start");
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

class FakeAudioContext extends EventTarget {
  static onCreate: ((context: FakeAudioContext) => void) | undefined;
  state: "running" | "suspended" | "closed" = "running";
  destination = {};
  audioWorklet = { addModule: vi.fn(async (): Promise<void> => undefined) };
  createMediaStreamSource = vi.fn(() => new FakeSourceNode());
  createAnalyser = vi.fn(() => new FakeAnalyserNode());
  resume = vi.fn(async () => {
    this.setState("running");
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  close = vi.fn(async () => {
    this.setState("closed");
  });
  setState(state: "running" | "suspended" | "closed") {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
  constructor(public options: unknown) {
    super();
    audioContexts.push(this);
    FakeAudioContext.onCreate?.(this);
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

let getUserMedia: Mock<
  (constraints?: MediaStreamConstraints) => Promise<FakeStream>
>;
let enumerateDevices: Mock<() => Promise<MediaDeviceInfo[]>>;
let mediaDevices: EventTarget;

const inputDevice = (deviceId: string): MediaDeviceInfo => ({
  kind: "audioinput",
  deviceId,
  groupId: "",
  label: deviceId,
  toJSON() {
    return {
      kind: this.kind,
      deviceId,
      groupId: this.groupId,
      label: this.label,
    };
  },
});

const setPriority = (...deviceIds: string[]) =>
  vi.spyOn(api.settings.getSettings, "useQuery").mockReturnValue({
    data: {
      recording: {
        microphonePriority: deviceIds.map((deviceId) => ({
          deviceId,
          name: deviceId,
        })),
      },
    },
  } as never);

const requestedDeviceIds = () =>
  getUserMedia.mock.calls.map(([request]) => {
    const audio = request?.audio;
    if (
      typeof audio !== "object" ||
      typeof audio.deviceId !== "object" ||
      Array.isArray(audio.deviceId)
    ) {
      throw new Error("Expected audio constraints with an exact device ID");
    }
    return audio.deviceId.exact;
  });

beforeEach(() => {
  FakeAudioContext.onCreate = undefined;
  vi.mocked(captureRendererException).mockClear();
  audioContexts = [];
  workletNodes = [];
  sources = [];
  analysers = [];
  streams = [];
  graphEvents = [];
  getUserMedia = vi.fn(async () => makeStream());
  enumerateDevices = vi.fn(async () => []);
  mediaDevices = Object.assign(new EventTarget(), {
    getUserMedia,
    enumerateDevices,
  });

  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
  (globalThis as Record<string, unknown>).AudioWorkletNode = FakeWorkletNode;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).AudioWorkletNode;
});

// Let the effect-driven async start/stop bodies (mutex + getUserMedia/addModule/
// context setup + the flush microtask) settle.
async function settle() {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

interface AudioCaptureHookProps {
  enabled: boolean;
  idle: boolean;
  sessionId: string | null;
}

function mountHook(reactStrictMode = false) {
  const onAudioChunk = vi.fn();
  const onCaptureStarted =
    vi.fn<NonNullable<UseAudioCaptureParams["onCaptureStarted"]>>();
  const onCaptureFailure = vi.fn();
  const onCaptureTimings = vi.fn();
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
        onCaptureTimings,
        sessionId,
        enabled,
        idle,
      }),
    { initialProps, reactStrictMode },
  );
  return {
    onAudioChunk,
    onCaptureStarted,
    onCaptureFailure,
    onCaptureTimings,
    ...view,
  };
}

describe("useAudioCapture lifecycle", () => {
  it("prepares the running context and connected worklet without opening the microphone", async () => {
    const { rerender } = mountHook();
    await settle();
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].state).toBe("running");
    expect(audioContexts[0].audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(workletNodes[0].connect).toHaveBeenCalledExactlyOnceWith(
      audioContexts[0].destination,
    );
    expect(workletNodes[0].messages).toEqual([]);
    expect(getUserMedia).not.toHaveBeenCalled();

    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(audioContexts).toHaveLength(1);
    expect(workletNodes).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("shares pending startup preparation with the first dictation", async () => {
    vi.useFakeTimers();
    const loading = Promise.withResolvers<void>();
    FakeAudioContext.onCreate = (context) => {
      context.audioWorklet.addModule.mockReturnValueOnce(loading.promise);
    };
    const { rerender, onCaptureStarted } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(audioContexts).toHaveLength(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onCaptureStarted).not.toHaveBeenCalled();

    // Waiting for preparation belongs to the elapsed recording attempt.
    await act(async () => vi.advanceTimersByTimeAsync(8 * 60_000));
    loading.resolve();
    await settle();
    expect(audioContexts).toHaveLength(1);
    expect(workletNodes).toHaveLength(1);
    expect(onCaptureStarted).toHaveBeenCalledOnce();
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    expect(audioContexts).toHaveLength(2);
    expect(audioContexts[0].state).toBe("closed");
  });

  it("reports a prewarm failure without failing a session and retries at capture", async () => {
    const failure = new Error("Could not prepare processor");
    FakeAudioContext.onCreate = (context) => {
      context.audioWorklet.addModule.mockRejectedValueOnce(failure);
    };
    const { rerender, onCaptureFailure, onCaptureStarted } = mountHook();
    await settle();
    expect(captureRendererException).toHaveBeenCalledExactlyOnceWith(
      failure,
      expect.objectContaining({
        operation: "worklet-load",
        session_id: undefined,
      }),
    );
    expect(audioContexts[0].state).toBe("closed");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onCaptureFailure).not.toHaveBeenCalled();

    FakeAudioContext.onCreate = undefined;
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(audioContexts).toHaveLength(2);
    expect(audioContexts[1].state).toBe("running");
    expect(onCaptureStarted).toHaveBeenCalledOnce();
    expect(onCaptureStarted.mock.calls[0][2]?.phases).toContainEqual(
      expect.objectContaining({ name: "capture.audio-context-create" }),
    );
    expect(onCaptureStarted.mock.calls[0][2]?.audioContext).toBeUndefined();
    expect(onCaptureFailure).not.toHaveBeenCalled();
  });

  it("keeps one prepared graph after StrictMode effect replay and closes it on unmount", async () => {
    const { unmount } = mountHook(true);
    await settle();
    expect(
      audioContexts.filter((context) => context.state === "running"),
    ).toHaveLength(1);
    expect(
      workletNodes.filter(
        (worklet) => worklet.disconnect.mock.calls.length === 0,
      ),
    ).toHaveLength(1);
    expect(getUserMedia).not.toHaveBeenCalled();

    unmount();
    await settle();
    expect(audioContexts.every((context) => context.state === "closed")).toBe(
      true,
    );
    expect(
      workletNodes.every(
        (worklet) => worklet.disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(captureRendererException).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "refreshes before every capture when enabled (ranked input: %s)",
    async (ranked) => {
      if (ranked) setPriority("mic-b", "mic-a");
      const endpoint = api.useUtils().client.remoteConfig.get;
      const config = await endpoint.query();
      vi.spyOn(endpoint, "query").mockResolvedValue({
        ...config,
        flags: {
          ...config.flags,
          [DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG]: true,
        },
      });
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
      const pending = Promise.withResolvers<MediaDeviceInfo[]>();
      enumerateDevices.mockReturnValueOnce(pending.promise);
      enumerateDevices.mockResolvedValue([inputDevice("mic-a")]);
      const { rerender, onCaptureStarted } = mountHook();
      await settle();

      rerender({ enabled: true, idle: false, sessionId: "session-1" });
      await settle();
      expect(enumerateDevices).toHaveBeenCalledTimes(2);
      expect(getUserMedia).not.toHaveBeenCalled();
      now = 100;
      pending.resolve([inputDevice("mic-a"), inputDevice("mic-b")]);
      await settle();
      expect(requestedDeviceIds()).toEqual([ranked ? "mic-b" : "default"]);
      expect(onCaptureStarted.mock.calls[0][2]?.phases).toContainEqual(
        expect.objectContaining({
          name: "capture.enumerate-devices",
          durationMs: 100,
        }),
      );

      rerender({ enabled: false, idle: false, sessionId: "session-1" });
      await settle();
      expect(enumerateDevices).toHaveBeenCalledTimes(3);
      rerender({ enabled: true, idle: false, sessionId: "session-2" });
      await settle();
      expect(enumerateDevices).toHaveBeenCalledTimes(4);
      expect(requestedDeviceIds()).toEqual(
        ranked ? ["mic-b", "mic-a"] : ["default", "default"],
      );
    },
  );

  it("applies the refresh flag on the next capture and returns to cached starts when disabled", async () => {
    setPriority("mic-b", "mic-a");
    const endpoint = api.useUtils().client.remoteConfig.get;
    const config = await endpoint.query();
    const query = vi.spyOn(endpoint, "query").mockResolvedValue({
      ...config,
      flags: {
        ...config.flags,
        [DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG]: false,
      },
    });
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    enumerateDevices.mockResolvedValue([inputDevice("mic-b")]);
    const { rerender } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(enumerateDevices).toHaveBeenCalledOnce();

    query.mockResolvedValue({
      ...config,
      flags: {
        ...config.flags,
        [DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG]: true,
      },
    });
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(enumerateDevices).toHaveBeenCalledOnce();
    expect(streams[0].track.stop).not.toHaveBeenCalled();

    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(enumerateDevices).toHaveBeenCalledTimes(3);
    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);

    query.mockResolvedValue({
      ...config,
      flags: {
        ...config.flags,
        [DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG]: false,
      },
    });
    rerender({ enabled: true, idle: false, sessionId: "session-3" });
    await settle();
    expect(enumerateDevices).toHaveBeenCalledTimes(4);
    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b", "mic-b"]);
  });

  it("falls back to default without repeating a failed startup refresh", async () => {
    setPriority("mic-a");
    const endpoint = api.useUtils().client.remoteConfig.get;
    const config = await endpoint.query();
    vi.spyOn(endpoint, "query").mockResolvedValue({
      ...config,
      flags: {
        ...config.flags,
        [DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG]: true,
      },
    });
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    enumerateDevices.mockRejectedValue(new Error("enumeration unavailable"));
    let enumerationsAtOpen = 0;
    getUserMedia.mockImplementation(async () => {
      enumerationsAtOpen = enumerateDevices.mock.calls.length;
      return makeStream();
    });
    const { rerender, onCaptureStarted } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(requestedDeviceIds()).toEqual(["default"]);
    expect(onCaptureStarted).toHaveBeenCalledOnce();
    // One initial snapshot, then the forced refresh and its readiness retry.
    expect(enumerationsAtOpen).toBe(3);
    expect(
      onCaptureStarted.mock.calls[0][2]?.phases.filter(
        (phase) => phase.name === "capture.enumerate-devices",
      ),
    ).toHaveLength(1);
  });

  it("starts on the default device without waiting for initial enumeration", async () => {
    const pending = Promise.withResolvers<MediaDeviceInfo[]>();
    enumerateDevices.mockReturnValueOnce(pending.promise);
    const { rerender, unmount } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();

    expect(requestedDeviceIds()).toEqual(["default"]);
    pending.resolve([]);
    await settle();
    unmount();
  });

  it("uses cached devices at ranked starts and applies changed preferences", async () => {
    const settingsQuery = setPriority("mic-a", "mic-b");
    enumerateDevices.mockResolvedValue([
      inputDevice("mic-a"),
      inputDevice("mic-b"),
    ]);
    const { rerender, onCaptureStarted } = mountHook();
    await settle();

    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-a"]);
    expect(enumerateDevices).toHaveBeenCalledOnce();

    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
    settingsQuery.mockReturnValue({
      data: {
        recording: {
          microphonePriority: [
            { deviceId: "mic-b", name: "mic-b" },
            { deviceId: "mic-a", name: "mic-a" },
          ],
        },
      },
    } as never);
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();

    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
    expect(onCaptureStarted.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        deviceId: "mic-b",
        captureSource: "preferred",
      }),
    );
  });

  it("refreshes on devicechange while idle and removes its listener on unmount", async () => {
    setPriority("mic-a", "mic-b");
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    enumerateDevices.mockResolvedValue([inputDevice("mic-b")]);
    const { rerender, unmount } = mountHook();
    await settle();
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await settle();
    expect(enumerateDevices).toHaveBeenCalledTimes(2);

    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-b"]);

    unmount();
    const count = enumerateDevices.mock.calls.length;
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await settle();
    expect(enumerateDevices).toHaveBeenCalledTimes(count);
  });

  it.each([false, true])(
    "refreshes cached devices after system resume (capture active: %s)",
    async (active) => {
      setPriority("mic-b", "mic-a");
      enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
      enumerateDevices.mockResolvedValue([
        inputDevice("mic-a"),
        inputDevice("mic-b"),
      ]);
      const subscribe = vi.spyOn(api.recording.systemResume, "useSubscription");
      const { rerender } = mountHook();
      await settle();
      rerender({ enabled: true, idle: false, sessionId: "session-1" });
      await settle();
      expect(requestedDeviceIds()).toEqual(["mic-a"]);
      if (!active) {
        enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
        rerender({ enabled: false, idle: true, sessionId: "session-1" });
        await settle();
      }

      const onResume = subscribe.mock.calls.at(-1)?.[1]?.onData;
      expect(onResume).toBeDefined();
      onResume?.(null);
      await settle();
      expect(enumerateDevices).toHaveBeenCalledTimes(active ? 2 : 3);
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(streams[0].track.stop).toHaveBeenCalledTimes(active ? 0 : 1);
      if (active) {
        rerender({ enabled: false, idle: false, sessionId: "session-1" });
        await settle();
      }

      rerender({ enabled: true, idle: false, sessionId: "session-2" });
      await settle();
      expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);
      expect(enumerateDevices).toHaveBeenCalledTimes(3);
    },
  );

  it("waits for an in-flight devicechange refresh before ranked selection", async () => {
    setPriority("mic-b", "mic-a");
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    const pending = Promise.withResolvers<MediaDeviceInfo[]>();
    enumerateDevices.mockReturnValueOnce(pending.promise);
    const { rerender } = mountHook();
    await settle();
    mediaDevices.dispatchEvent(new Event("devicechange"));
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();

    pending.resolve([inputDevice("mic-a"), inputDevice("mic-b")]);
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-b"]);
  });

  it.each(["resolve", "reject"])(
    "uses the newest refresh without waiting for an obsolete one to %s",
    async (outcome) => {
      setPriority("mic-b", "mic-a");
      const older = Promise.withResolvers<MediaDeviceInfo[]>();
      enumerateDevices.mockReturnValueOnce(older.promise);
      enumerateDevices.mockResolvedValue([inputDevice("mic-b")]);
      const { rerender } = mountHook();
      rerender({ enabled: true, idle: false, sessionId: "session-1" });
      await settle();
      expect(getUserMedia).not.toHaveBeenCalled();

      mediaDevices.dispatchEvent(new Event("devicechange"));
      await settle();
      try {
        expect(requestedDeviceIds()).toEqual(["mic-b"]);
        rerender({ enabled: false, idle: false, sessionId: "session-1" });
        await settle();
      } finally {
        if (outcome === "resolve") older.resolve([inputDevice("mic-a")]);
        else older.reject(new Error("obsolete enumeration failed"));
        await settle();
      }

      rerender({ enabled: true, idle: false, sessionId: "session-2" });
      await settle();
      expect(requestedDeviceIds()).toEqual(["mic-b", "mic-b"]);
      expect(enumerateDevices).toHaveBeenCalledTimes(3);
    },
  );

  it("retries a failed devicechange refresh at the next ranked capture", async () => {
    setPriority("mic-b", "mic-a");
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    enumerateDevices.mockResolvedValue([
      inputDevice("mic-a"),
      inputDevice("mic-b"),
    ]);
    const { rerender } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-a"]);

    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    enumerateDevices.mockRejectedValueOnce(new Error("enumeration failed"));
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);
    expect(enumerateDevices).toHaveBeenCalledTimes(4);
  });

  it("waits for a cold ranked snapshot", async () => {
    setPriority("mic-a");
    const pending = Promise.withResolvers<MediaDeviceInfo[]>();
    enumerateDevices.mockReturnValueOnce(pending.promise);
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();

    pending.resolve([inputDevice("mic-a")]);
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-a"]);
  });

  it("refreshes a pre-permission snapshot after the first successful capture", async () => {
    setPriority("mic-a");
    enumerateDevices.mockResolvedValueOnce([]);
    enumerateDevices.mockResolvedValue([inputDevice("mic-a")]);
    const { rerender } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();

    expect(requestedDeviceIds()).toEqual(["default", "mic-a"]);
    expect(enumerateDevices).toHaveBeenCalledTimes(3);
  });

  it("retries a failed post-permission refresh before the next ranked capture", async () => {
    setPriority("mic-a");
    enumerateDevices.mockResolvedValueOnce([]);
    enumerateDevices.mockRejectedValueOnce(new Error("enumeration failed"));
    enumerateDevices.mockRejectedValueOnce(new Error("stop refresh failed"));
    enumerateDevices.mockResolvedValue([inputDevice("mic-a")]);
    const { rerender } = mountHook();
    await settle();
    for (const sessionId of ["session-1", "session-2", "session-3"]) {
      rerender({ enabled: true, idle: false, sessionId });
      await settle();
      if (sessionId !== "session-3") {
        rerender({ enabled: false, idle: false, sessionId });
        await settle();
      }
    }

    expect(requestedDeviceIds()).toEqual(["default", "mic-a", "mic-a"]);
    expect(enumerateDevices).toHaveBeenCalledTimes(5);
  });

  it("does not repeat the permission refresh when labels stay blank", async () => {
    setPriority("mic-a");
    enumerateDevices.mockResolvedValue([
      {
        ...inputDevice("mic-a"),
        label: "",
      },
    ]);
    const { rerender } = mountHook();
    await settle();
    for (const sessionId of ["session-1", "session-2"]) {
      rerender({ enabled: true, idle: false, sessionId });
      await settle();
      rerender({ enabled: false, idle: false, sessionId });
      await settle();
    }

    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-a"]);
    // Initial snapshot, one permission refresh, and one refresh after each stop.
    expect(enumerateDevices).toHaveBeenCalledTimes(4);
  });

  it("reselects once after a stale exact device fails", async () => {
    setPriority("mic-a", "mic-b");
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    enumerateDevices.mockResolvedValue([inputDevice("mic-b")]);
    getUserMedia.mockRejectedValueOnce(
      new DOMException("gone", "NotFoundError"),
    );
    const { rerender, onCaptureStarted } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();

    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);
    expect(onCaptureStarted).toHaveBeenCalledOnce();
  });

  it("includes the full device refresh recovery wait in startup timing", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    setPriority("mic-a", "mic-b");
    const recovery = Promise.withResolvers<MediaDeviceInfo[]>();
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    enumerateDevices.mockRejectedValueOnce(new Error("enumeration failed"));
    enumerateDevices.mockReturnValueOnce(recovery.promise);
    getUserMedia.mockRejectedValueOnce(
      new DOMException("gone", "NotFoundError"),
    );
    const { rerender, onCaptureStarted } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(enumerateDevices).toHaveBeenCalledTimes(3);
    expect(onCaptureStarted).not.toHaveBeenCalled();

    now = 100;
    recovery.resolve([inputDevice("mic-b")]);
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);
    const startup = onCaptureStarted.mock.calls[0][2];
    expect(
      startup?.phases.filter(
        (phase) => phase.name === "capture.enumerate-devices",
      ),
    ).toEqual([expect.objectContaining({ durationMs: 100 })]);
  });

  it("does not retry a permission failure", async () => {
    setPriority("mic-a");
    enumerateDevices.mockResolvedValue([inputDevice("mic-a")]);
    getUserMedia.mockRejectedValueOnce(
      new DOMException("denied", "NotAllowedError"),
    );
    const { rerender, onCaptureFailure } = mountHook();
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();

    expect(requestedDeviceIds()).toEqual(["mic-a"]);
    expect(enumerateDevices).toHaveBeenCalledOnce();
    expect(onCaptureFailure).toHaveBeenCalledOnce();
  });

  it("keeps prewarm timing out of capture batches and reports first-frame phases per session", async () => {
    const { rerender, onCaptureStarted, onCaptureTimings } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "first" });
    await settle();
    const startup = onCaptureStarted.mock.calls[0][2];
    expect(startup?.phases.map((phase) => phase.name)).toEqual([
      "capture.get-user-media",
    ]);

    // An empty final frame must not claim that real PCM arrived.
    await act(async () => {
      workletNodes[0].port.onmessage?.({
        data: { type: "audioFrame", frame: new Float32Array(0) },
      });
    });
    expect(onCaptureTimings).not.toHaveBeenCalled();
    await act(async () => {
      workletNodes[0].port.onmessage?.({
        data: { type: "audioFrame", frame: new Float32Array(512) },
      });
    });
    expect(onCaptureTimings).toHaveBeenCalledWith(
      "first",
      expect.objectContaining({
        phases: [
          expect.objectContaining({
            name: "capture.first-frame-wait",
          }),
        ],
      }),
      false,
    );

    rerender({ enabled: true, idle: false, sessionId: "warm" });
    await settle();
    expect(onCaptureTimings).toHaveBeenCalledWith(
      "first",
      { phases: [] },
      true,
    );
    const warm = onCaptureStarted.mock.calls[1][2];
    expect(warm?.phases.map((phase) => phase.name)).toEqual([
      "capture.get-user-media",
    ]);
  });

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
    });
    expect(workletNodes[0].messages).toContainEqual({
      type: "start",
      stereoDownmixEnabled: true,
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
    expect(workletNodes).toHaveLength(1);
    expect(workletNodes[0].messages.at(-1)).toEqual({
      type: "start",
      stereoDownmixEnabled: false,
    });
  });

  it("releases capture after a failed flush without claiming a first-frame timing", async () => {
    const { rerender, onCaptureTimings } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    workletNodes[0].port.postMessage = () => {
      throw new Error("port closed");
    };
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    expect(onCaptureTimings).toHaveBeenCalledWith(
      "session-1",
      { phases: [] },
      true,
    );
    expect(streams[0].track.stop).toHaveBeenCalled();
    expect(audioContexts[0].state).toBe("closed");
    expect(workletNodes[0].disconnect).toHaveBeenCalledOnce();
  });

  it("does not open the mic after unmount while waiting for config", async () => {
    const query = vi.spyOn(api.useUtils().client.remoteConfig.get, "query");
    const pendingConfig =
      Promise.withResolvers<Awaited<ReturnType<typeof query>>>();
    query.mockReturnValueOnce(pendingConfig.promise);
    const { rerender, unmount, onCaptureTimings } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(query).toHaveBeenCalledOnce();
    unmount();
    pendingConfig.resolve({
      flags: { "desktop-stereo-mic-downmix": true },
    } as never);
    await settle();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(workletNodes).toHaveLength(1);
    expect(audioContexts[0].state).toBe("closed");
    expect(onCaptureTimings).toHaveBeenCalledWith(
      "session-1",
      { phases: [] },
      true,
    );
  });

  it("closes pending prewarm after unmount without opening the microphone", async () => {
    const pendingModule = Promise.withResolvers<undefined>();
    (globalThis as Record<string, unknown>).AudioContext = class extends (
      FakeAudioContext
    ) {
      audioWorklet = { addModule: vi.fn(() => pendingModule.promise) };
    };
    const { rerender, unmount, onCaptureTimings } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const context = audioContexts[0];

    unmount();
    pendingModule.resolve(undefined);
    await settle();

    expect(context.close).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled();
    const batch = onCaptureTimings.mock.calls[0][1] as CaptureTimingsBatch;
    expect(batch.phases).toEqual([]);
  });

  it("falls back to first-channel capture if the config IPC read fails", async () => {
    vi.spyOn(api.useUtils().client.remoteConfig.get, "query").mockRejectedValue(
      new Error("IPC unavailable"),
    );
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(workletNodes[0].messages).toContainEqual({
      type: "start",
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
    expect(onCaptureFailure).toHaveBeenCalledWith(
      {
        sessionId: "session-1",
        name: "NotAllowedError",
        message: "Permission denied",
      },
      { phases: [] },
    );
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].state).toBe("closed");
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
    expect(workletNodes[0].connect).toHaveBeenCalledOnce();
    expect(workletNodes[0].connect).toHaveBeenCalledWith(
      audioContexts[0].destination,
    );
    // source connected to the worklet node
    expect(sources[0].connect).toHaveBeenCalledWith(workletNodes[0]);
    expect(graphEvents).toEqual(["start", "source-connect"]);
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
      expect.objectContaining({ phases: expect.any(Array) }),
    );
    expect(onCaptureStarted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ captureSource: "default" }),
      "session-2",
      expect.objectContaining({ phases: expect.any(Array) }),
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

  it("keeps one running AudioContext and worklet across dictations", async () => {
    const { rerender } = mountHook();

    // First dictation.
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    // Stop without going idle, so the running context and worklet are retained.
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();

    expect(audioContexts[0].suspend).not.toHaveBeenCalled();
    expect(audioContexts[0].state).toBe("running");
    expect(sources[0].disconnect).toHaveBeenCalledWith();
    expect(analysers[0].disconnect).toHaveBeenCalledOnce();
    expect(workletNodes[0].disconnect).not.toHaveBeenCalled();
    expect(workletNodes[0].messages.map((message) => message.type)).toEqual([
      "start",
      "flush",
    ]);

    // Second dictation reuses the same context and worklet.
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();

    // Warm reuse: no new AudioContext, module load, or worklet node.
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(audioContexts[0].resume).not.toHaveBeenCalled();
    expect(workletNodes).toHaveLength(1);
    expect(workletNodes[0].connect).toHaveBeenCalledOnce();
    expect(workletNodes[0].messages.map((message) => message.type)).toEqual([
      "start",
      "flush",
      "start",
    ]);
    expect(sources).toHaveLength(2);
    expect(analysers).toHaveLength(2);
    expect(graphEvents).toEqual([
      "start",
      "source-connect",
      "start",
      "source-connect",
    ]);
  });

  it("waits for the previous session's delayed final frame before reusing its worklet", async () => {
    const { rerender, onAudioChunk, onCaptureStarted } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const worklet = workletNodes[0];
    const postMessage = vi
      .spyOn(worklet.port, "postMessage")
      .mockImplementationOnce(() => {});

    // Queue the next capture while stop is still waiting for the old worklet.
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "flush" });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(onCaptureStarted).toHaveBeenCalledOnce();
    expect(streams[0].track.stop).not.toHaveBeenCalled();

    await act(async () => {
      worklet.port.onmessage?.({
        data: {
          type: "audioFrame",
          frame: new Float32Array([0.25]),
          isFinal: true,
        },
      });
    });
    await settle();
    expect(onAudioChunk).toHaveBeenNthCalledWith(
      1,
      "session-1",
      expect.any(ArrayBuffer),
      0,
      true,
      undefined,
    );
    expect(streams[0].track.stop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(workletNodes).toEqual([worklet]);

    await act(async () => {
      worklet.port.onmessage?.({
        data: { type: "audioFrame", frame: new Float32Array([0.5]) },
      });
    });
    expect(onAudioChunk).toHaveBeenNthCalledWith(
      2,
      "session-2",
      expect.any(ArrayBuffer),
      0,
      false,
      undefined,
    );
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

  it.each([false, true])(
    "refreshes devices after cleanup without holding up stop (ranked input: %s)",
    async (ranked) => {
      if (ranked) setPriority("mic-b", "mic-a");
      enumerateDevices.mockResolvedValue([inputDevice("mic-a")]);
      const { rerender, onCaptureStarted, onCaptureTimings } = mountHook();
      await settle();
      rerender({ enabled: true, idle: false, sessionId: "session-1" });
      await settle();
      const pending = Promise.withResolvers<MediaDeviceInfo[]>();
      enumerateDevices.mockReturnValueOnce(pending.promise);

      rerender({ enabled: false, idle: true, sessionId: null });
      await settle();
      expect(enumerateDevices).toHaveBeenCalledTimes(2);
      expect(enumerateDevices.mock.invocationCallOrder[1]).toBeGreaterThan(
        streams[0].track.stop.mock.invocationCallOrder[0],
      );
      expect(enumerateDevices.mock.invocationCallOrder[1]).toBeGreaterThan(
        sources[0].disconnect.mock.invocationCallOrder[0],
      );
      expect(onCaptureTimings).toHaveBeenLastCalledWith(
        "session-1",
        { phases: [] },
        true,
      );
      expect(audioContexts[0].close).not.toHaveBeenCalled();

      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      rerender({ enabled: true, idle: false, sessionId: "session-2" });
      await settle();
      expect(getUserMedia).toHaveBeenCalledTimes(ranked ? 1 : 2);
      now = 100;
      pending.resolve([inputDevice("mic-b")]);
      await settle();

      expect(requestedDeviceIds()).toEqual(
        ranked ? ["mic-a", "mic-b"] : ["default", "default"],
      );
      expect(enumerateDevices).toHaveBeenCalledTimes(2);
      expect(audioContexts).toHaveLength(1);
      expect(workletNodes).toHaveLength(1);
      expect(
        onCaptureStarted.mock.calls[1][2]?.phases.filter(
          (phase) => phase.name === "capture.enumerate-devices",
        ),
      ).toEqual(ranked ? [expect.objectContaining({ durationMs: 100 })] : []);
    },
  );

  it("replaces a context and worklet that closed between dictations", async () => {
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();

    audioContexts[0].state = "closed";
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();

    expect(audioContexts).toHaveLength(2);
    expect(workletNodes).toHaveLength(2);
    expect(workletNodes[1].context).toBe(audioContexts[1]);
    expect(workletNodes[1].connect).toHaveBeenCalledWith(
      audioContexts[1].destination,
    );
  });

  it("resumes a suspended context with its existing worklet", async () => {
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();

    audioContexts[0].state = "suspended";
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();

    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].resume).toHaveBeenCalledOnce();
    expect(workletNodes).toHaveLength(1);
    expect(workletNodes[0].connect).toHaveBeenCalledOnce();
    expect(sources[1].connect).toHaveBeenCalledWith(workletNodes[0]);
  });

  it("closes after one hour idle and creates a new context on the next dictation", async () => {
    vi.useFakeTimers();
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    // The idle window starts after the recording's cleanup.
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUDIO_CONTEXT_IDLE_TIMEOUT_MS - 1);
    });
    expect(audioContexts[0].close).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(audioContexts[0].close).toHaveBeenCalled();
    expect(audioContexts[0].state).toBe("closed");
    expect(workletNodes[0].disconnect).toHaveBeenCalledOnce();
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(audioContexts).toHaveLength(2);
    expect(workletNodes).toHaveLength(2);
  });

  it.each([
    { idleMinutes: 8, attemptMs: 5_000, replaced: false },
    { idleMinutes: 1, attemptMs: 5_001, replaced: false },
    { idleMinutes: 8, attemptMs: 5_001, replaced: true },
  ])(
    "recycles only after qualifying cleanup: $idleMinutes idle minutes, $attemptMs ms attempt",
    async ({ idleMinutes, attemptMs, replaced }) => {
      vi.useFakeTimers();
      const { rerender } = mountHook();
      await settle();
      await act(async () => vi.advanceTimersByTimeAsync(idleMinutes * 60_000));
      // Age alone does not trigger replacement while idle.
      expect(audioContexts).toHaveLength(1);
      expect(audioContexts[0].close).not.toHaveBeenCalled();
      rerender({ enabled: true, idle: false, sessionId: "session-1" });
      await settle();
      await act(async () => vi.advanceTimersByTimeAsync(attemptMs));
      expect(audioContexts[0].close).not.toHaveBeenCalled();

      rerender({ enabled: false, idle: true, sessionId: null });
      await settle();
      expect(streams[0].track.stop).toHaveBeenCalledOnce();
      expect(audioContexts).toHaveLength(replaced ? 2 : 1);
      expect(audioContexts[0].state).toBe(replaced ? "closed" : "running");
      expect(audioContexts.at(-1)?.state).toBe("running");
      expect(getUserMedia).toHaveBeenCalledOnce();
    },
  );

  it("flushes and replaces a qualifying context before starting the next capture", async () => {
    vi.useFakeTimers();
    const { rerender, onAudioChunk, onCaptureStarted } = mountHook();
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(8 * 60_000));
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(5_001));
    const oldWorklet = workletNodes[0];
    vi.spyOn(oldWorklet.port, "postMessage").mockImplementationOnce(() => {});
    const replacementLoading = Promise.withResolvers<void>();
    FakeAudioContext.onCreate = (context) => {
      context.audioWorklet.addModule.mockReturnValueOnce(
        replacementLoading.promise,
      );
    };

    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(audioContexts[0].close).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => {
      oldWorklet.port.onmessage?.({
        data: {
          type: "audioFrame",
          frame: new Float32Array([0.25]),
          isFinal: true,
        },
      });
    });
    await settle();
    expect(onAudioChunk).toHaveBeenCalledWith(
      "session-1",
      expect.any(ArrayBuffer),
      0,
      true,
      undefined,
    );
    expect(streams[0].track.stop).toHaveBeenCalledOnce();
    expect(audioContexts[0].state).toBe("closed");
    expect(audioContexts).toHaveLength(2);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(onCaptureStarted).toHaveBeenCalledOnce();

    replacementLoading.resolve();
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(onCaptureStarted).toHaveBeenCalledTimes(2);
    expect(sources[1].connect).toHaveBeenCalledWith(workletNodes[1]);
    expect(oldWorklet.port.onmessage).toBeNull();
  });

  it("reports completed recovery before replacement preparation can delay the final batch", async () => {
    vi.useFakeTimers();
    const { rerender, onCaptureTimings } = mountHook();
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(8 * 60_000));
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    await act(async () => {
      workletNodes[0].port.onmessage?.({
        data: { type: "audioFrame", frame: new Float32Array([0.25]) },
      });
      audioContexts[0].setState("suspended");
    });
    await act(async () => vi.advanceTimersByTimeAsync(5_001));
    const loading = Promise.withResolvers<void>();
    FakeAudioContext.onCreate = (context) => {
      context.audioWorklet.addModule.mockReturnValueOnce(loading.promise);
    };
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    expect(audioContexts).toHaveLength(2);
    expect(onCaptureTimings).toHaveBeenLastCalledWith(
      "session-1",
      expect.objectContaining({
        audioContext: expect.objectContaining({
          recoveryAttemptCount: 1,
          recoverySuccessCount: 1,
        }),
      }),
      false,
    );
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(onCaptureTimings.mock.lastCall?.[2]).toBe(false);
    loading.resolve();
    await settle();
    expect(onCaptureTimings.mock.lastCall?.[2]).toBe(true);
  });

  it("leaves the context closed if the idle deadline expires while replacement is closing it", async () => {
    vi.useFakeTimers();
    const { rerender } = mountHook();
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(8 * 60_000));
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(5_001));
    const closing = Promise.withResolvers<void>();
    audioContexts[0].close.mockImplementationOnce(async () => {
      audioContexts[0].setState("closed");
      await closing.promise;
    });
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    expect(audioContexts[0].close).toHaveBeenCalledOnce();
    await act(async () =>
      vi.advanceTimersByTimeAsync(AUDIO_CONTEXT_IDLE_TIMEOUT_MS),
    );
    closing.resolve();
    await settle();
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].state).toBe("closed");
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(captureRendererException).not.toHaveBeenCalled();
  });

  it("restarts the full idle hour after a short recording on an old context", async () => {
    vi.useFakeTimers();
    const { rerender } = mountHook();
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(59 * 60_000));
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    await act(async () =>
      vi.advanceTimersByTimeAsync(AUDIO_CONTEXT_IDLE_TIMEOUT_MS - 1),
    );
    expect(audioContexts).toHaveLength(1);
    expect(audioContexts[0].close).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(audioContexts[0].close).toHaveBeenCalledOnce();
  });

  it("recovers an active context suspension and reports the outcome", async () => {
    const { rerender, onCaptureFailure, onCaptureTimings } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();

    await act(async () => audioContexts[0].setState("suspended"));
    expect(audioContexts[0].resume).toHaveBeenCalledOnce();
    expect(audioContexts[0].state).toBe("running");
    expect(onCaptureFailure).not.toHaveBeenCalled();
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    expect(onCaptureTimings).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        audioContext: {
          recoveryAttemptCount: 1,
          recoverySuccessCount: 1,
          recoveryFailureCount: 0,
          recoveryDurationMs: expect.any(Number),
        },
      }),
      true,
    );
  });

  it("reports a rejected active resume through the current session failure path", async () => {
    const { rerender, onCaptureFailure } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const error = new Error("Audio device unavailable");
    audioContexts[0].resume.mockRejectedValueOnce(error);

    await act(async () => audioContexts[0].setState("suspended"));
    expect(onCaptureFailure).toHaveBeenCalledOnce();
    expect(onCaptureFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        message: error.message,
      }),
      expect.anything(),
    );
    expect(captureRendererException).toHaveBeenCalledOnce();
    expect(onCaptureFailure.mock.calls[0][1].audioContext).toEqual({
      recoveryAttemptCount: 1,
      recoverySuccessCount: 0,
      recoveryFailureCount: 1,
      recoveryDurationMs: expect.any(Number),
      failureOperation: "recover",
      failureState: "suspended",
    });

    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    expect(streams[0].track.stop).toHaveBeenCalled();
  });

  it("does not apply a late resume failure to a later recording", async () => {
    const { rerender, onCaptureFailure, onCaptureTimings } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const recovery = Promise.withResolvers<void>();
    audioContexts[0].resume.mockReturnValueOnce(recovery.promise);
    await act(async () => audioContexts[0].setState("suspended"));

    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    await act(async () => recovery.reject(new Error("Old recovery failed")));
    expect(onCaptureFailure).not.toHaveBeenCalled();
    expect(captureRendererException).not.toHaveBeenCalled();
    expect(onCaptureTimings.mock.calls[0][0]).toBe("session-1");
    expect(onCaptureTimings.mock.calls[0][1].audioContext).toEqual({
      recoveryAttemptCount: 1,
      recoverySuccessCount: 0,
      recoveryFailureCount: 0,
      recoveryDurationMs: 0,
    });
    rerender({ enabled: false, idle: true, sessionId: null });
    await settle();
    expect(onCaptureTimings).toHaveBeenLastCalledWith(
      "session-2",
      { phases: [] },
      true,
    );
  });

  it("reports unexpected closure but ignores intentional teardown", async () => {
    const { rerender, onCaptureFailure, unmount } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    await act(async () => audioContexts[0].setState("closed"));
    await act(async () => {
      streams[0].track.dispatchEvent(new Event("ended"));
    });
    expect(onCaptureFailure).toHaveBeenCalledOnce();
    expect(captureRendererException).toHaveBeenCalledOnce();

    unmount();
    await settle();
    expect(onCaptureFailure).toHaveBeenCalledOnce();
    expect(captureRendererException).toHaveBeenCalledOnce();
  });

  it("reports context construction failure and releases the microphone", async () => {
    const failure = new Error("Audio service unavailable");
    const { rerender, onCaptureFailure } = mountHook();
    await settle();
    audioContexts[0].state = "closed";
    FakeAudioContext.onCreate = () => {
      throw failure;
    };
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(captureRendererException).toHaveBeenCalledOnce();
    expect(captureRendererException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ operation: "create", session_id: "session-1" }),
    );
    expect(onCaptureFailure).toHaveBeenCalledOnce();
    expect(onCaptureFailure.mock.calls[0][1].audioContext).toMatchObject({
      failureOperation: "create",
      failureState: undefined,
    });
    expect(streams[0].track.stop).toHaveBeenCalledOnce();
  });

  it("reports a startup resume failure and retires its context", async () => {
    const { rerender, onCaptureFailure } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    const failure = new Error("Could not resume audio device");
    audioContexts[0].state = "suspended";
    audioContexts[0].resume.mockRejectedValueOnce(failure);
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(captureRendererException).toHaveBeenCalledOnce();
    expect(captureRendererException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ operation: "resume", session_id: "session-2" }),
    );
    expect(onCaptureFailure).toHaveBeenCalledOnce();
    expect(onCaptureFailure.mock.calls[0][1].audioContext).toMatchObject({
      failureOperation: "resume",
      failureState: "suspended",
    });
    expect(audioContexts[0].close).toHaveBeenCalledOnce();
    expect(streams[1].track.stop).toHaveBeenCalledOnce();
  });

  it("reports worklet loading failure and releases the microphone and context", async () => {
    const failure = new Error("Could not load processor");
    const { rerender, onCaptureFailure } = mountHook();
    await settle();
    audioContexts[0].state = "closed";
    FakeAudioContext.onCreate = (context) => {
      context.audioWorklet.addModule.mockRejectedValueOnce(failure);
    };
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(captureRendererException).toHaveBeenCalledOnce();
    expect(captureRendererException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        operation: "worklet-load",
        session_id: "session-1",
      }),
    );
    expect(onCaptureFailure).toHaveBeenCalledOnce();
    expect(onCaptureFailure.mock.calls[0][1].audioContext).toMatchObject({
      failureOperation: "worklet-load",
      failureState: "running",
    });
    expect(audioContexts[1].close).toHaveBeenCalledOnce();
    expect(streams[0].track.stop).toHaveBeenCalledOnce();
  });

  it("resumes a newly created context if it initially starts suspended", async () => {
    FakeAudioContext.onCreate = (context) => {
      context.state = "suspended";
    };
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    expect(audioContexts[0].resume).toHaveBeenCalledOnce();
    expect(audioContexts[0].state).toBe("running");
    expect(captureRendererException).not.toHaveBeenCalled();
  });

  it("releases the mic and context on unmount", async () => {
    const { rerender, unmount } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "session-1" });
    await settle();
    const track = streams[0].track;
    const enumerations = enumerateDevices.mock.calls.length;

    unmount();
    await settle();

    expect(track.stop).toHaveBeenCalled();
    expect(audioContexts[0].close).toHaveBeenCalled();
    expect(workletNodes[0].disconnect).toHaveBeenCalledOnce();
    expect(captureRendererException).not.toHaveBeenCalled();
    expect(enumerateDevices).toHaveBeenCalledTimes(enumerations);
  });
});
