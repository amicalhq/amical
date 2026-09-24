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

import {
  useAudioCapture,
  type UseAudioCaptureParams,
} from "@/hooks/useAudioCapture";
import { api } from "@/trpc/react";
import type { CaptureTimingsBatch } from "@/types/capture-timings";
import { DESKTOP_REFRESH_AUDIO_DEVICES_ON_START_FLAG } from "@/types/audio-capture";

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

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  destination = {};
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
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).AudioWorkletNode;
});

// Let the effect-driven async start/stop bodies (mutex + getUserMedia/addModule/
// context setup + the flush microtask) settle.
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
    { initialProps },
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
      rerender({ enabled: true, idle: false, sessionId: "session-2" });
      await settle();
      expect(enumerateDevices).toHaveBeenCalledTimes(3);
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
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
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
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
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

  it("uses one recorder snapshot across ranked starts and applies changed preferences", async () => {
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
    expect(enumerateDevices).toHaveBeenCalledOnce();
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
        rerender({ enabled: false, idle: true, sessionId: "session-1" });
        await settle();
      }

      const onResume = subscribe.mock.calls.at(-1)?.[1]?.onData;
      expect(onResume).toBeDefined();
      onResume?.(null);
      await settle();
      expect(enumerateDevices).toHaveBeenCalledTimes(2);
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(streams[0].track.stop).toHaveBeenCalledTimes(active ? 0 : 1);
      if (active) {
        rerender({ enabled: false, idle: false, sessionId: "session-1" });
        await settle();
      }

      rerender({ enabled: true, idle: false, sessionId: "session-2" });
      await settle();
      expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);
      expect(enumerateDevices).toHaveBeenCalledTimes(2);
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
      } finally {
        if (outcome === "resolve") older.resolve([inputDevice("mic-a")]);
        else older.reject(new Error("obsolete enumeration failed"));
        await settle();
      }

      rerender({ enabled: false, idle: false, sessionId: "session-1" });
      await settle();
      rerender({ enabled: true, idle: false, sessionId: "session-2" });
      await settle();
      expect(requestedDeviceIds()).toEqual(["mic-b", "mic-b"]);
      expect(enumerateDevices).toHaveBeenCalledTimes(2);
    },
  );

  it("retries a failed devicechange refresh at the next ranked capture", async () => {
    setPriority("mic-b", "mic-a");
    enumerateDevices.mockResolvedValueOnce([inputDevice("mic-a")]);
    enumerateDevices.mockRejectedValueOnce(new Error("enumeration failed"));
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
    mediaDevices.dispatchEvent(new Event("devicechange"));
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();
    expect(requestedDeviceIds()).toEqual(["mic-a", "mic-b"]);
    expect(enumerateDevices).toHaveBeenCalledTimes(3);
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
    rerender({ enabled: false, idle: false, sessionId: "session-1" });
    await settle();
    rerender({ enabled: true, idle: false, sessionId: "session-2" });
    await settle();

    expect(requestedDeviceIds()).toEqual(["default", "mic-a"]);
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
  });

  it("retries a failed post-permission refresh before the next ranked capture", async () => {
    setPriority("mic-a");
    enumerateDevices.mockResolvedValueOnce([]);
    enumerateDevices.mockRejectedValueOnce(new Error("enumeration failed"));
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
    expect(enumerateDevices).toHaveBeenCalledTimes(3);
  });

  it("does not refresh on every capture when labels stay blank", async () => {
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
    expect(enumerateDevices).toHaveBeenCalledTimes(2);
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

  it("batches cold and warm startup and first-frame phases for their own session", async () => {
    const { rerender, onCaptureStarted, onCaptureTimings } = mountHook();
    rerender({ enabled: true, idle: false, sessionId: "cold" });
    await settle();
    const startup = onCaptureStarted.mock.calls[0][2];
    expect(startup?.phases.map((phase) => phase.name)).toEqual([
      "capture.get-user-media",
      "capture.audio-context-create",
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
      "cold",
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
    expect(onCaptureTimings).toHaveBeenCalledWith("cold", { phases: [] }, true);
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
    expect(workletNodes).toHaveLength(0);
    expect(onCaptureTimings).toHaveBeenCalledWith(
      "session-1",
      { phases: [] },
      true,
    );
  });

  it("reports startup timings and releases capture when unmounted during worklet loading", async () => {
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
    expect(streams[0].track.stop).toHaveBeenCalled();
    const batch = onCaptureTimings.mock.calls[0][1] as CaptureTimingsBatch;
    expect(batch.phases.map((phase) => phase.name)).toEqual([
      "capture.get-user-media",
      "capture.audio-context-create",
    ]);
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
    expect(workletNodes[0].disconnect).toHaveBeenCalledOnce();
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
    expect(workletNodes[0].disconnect).toHaveBeenCalledOnce();
  });
});
