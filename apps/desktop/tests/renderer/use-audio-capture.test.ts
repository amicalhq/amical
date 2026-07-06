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

// ── Web Audio fakes ────────────────────────────────────────────────────────────
interface FakeTrack {
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
  const track: FakeTrack = { kind: "audio", stop: vi.fn() };
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

function mountHook() {
  const onAudioChunk = vi.fn();
  const view = renderHook(
    ({ enabled, idle }: { enabled: boolean; idle: boolean }) =>
      useAudioCapture({ onAudioChunk, enabled, idle }),
    { initialProps: { enabled: false, idle: true } },
  );
  return { onAudioChunk, ...view };
}

describe("useAudioCapture lifecycle", () => {
  it("opens the mic and wires source -> worklet on start", async () => {
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false });
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

  it("keeps the AudioContext warm across dictations but creates a fresh worklet node each time", async () => {
    const { rerender } = mountHook();

    // First dictation.
    rerender({ enabled: true, idle: false });
    await settle();
    // Stop WITHOUT going idle (transient), so the context is suspended, not recycled.
    rerender({ enabled: false, idle: false });
    await settle();

    expect(audioContexts[0].suspend).toHaveBeenCalled();
    expect(audioContexts[0].state).toBe("suspended");
    // The source is fully disconnected on stop, so its worklet + analyser-tap
    // edges don't accumulate on the retained warm context.
    expect(sources[0].disconnect).toHaveBeenCalledWith();

    // Second dictation reuses the same (warm) context.
    rerender({ enabled: true, idle: false });
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
    rerender({ enabled: true, idle: false });
    await settle();
    const track = streams[0].track;

    rerender({ enabled: false, idle: false });
    await settle();

    expect(track.stop).toHaveBeenCalled();
    expect(audioContexts[0].close).not.toHaveBeenCalled(); // kept warm
  });

  it("recycles (closes) the warm context once idle for the recycle delay", async () => {
    const { rerender } = mountHook();
    rerender({ enabled: true, idle: false });
    await settle();
    // Stop and go idle -> idle effect schedules the (mocked-short) recycle timer.
    rerender({ enabled: false, idle: true });
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
    rerender({ enabled: true, idle: false });
    await settle();
    const track = streams[0].track;

    unmount();
    await settle();

    expect(track.stop).toHaveBeenCalled();
    expect(audioContexts[0].close).toHaveBeenCalled();
  });
});
