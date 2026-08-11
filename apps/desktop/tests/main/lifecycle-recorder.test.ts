import { describe, expect, it } from "vitest";
import {
  createRecorderAdapter,
  type AmbianceContext,
  type RecorderAdapter,
  type WavCustodyWriter,
} from "../../src/main/lifecycle/adapters/recorder";
import type { LifecyclePortFact } from "../../src/main/lifecycle/ports";
import { FakeTimers } from "../helpers/lifecycle-fakes";

const DEAD_MIC_MS = 5;
const DRAIN_MS = 7;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeWriter implements WavCustodyWriter {
  appended: Float32Array[] = [];
  finalized = false;
  aborted = false;

  async appendAudio(chunk: Float32Array): Promise<void> {
    this.appended.push(chunk);
  }
  async finalize(): Promise<void> {
    this.finalized = true;
  }
  async abort(): Promise<void> {
    this.aborted = true;
  }
}

function makeHarness() {
  const facts: LifecyclePortFact[] = [];
  const feeds: Array<{ session: string; length: number }> = [];
  const custodyCalls: string[] = [];
  const timers = new FakeTimers();
  const writers: FakeWriter[] = [];
  const ambianceEnds: Array<AmbianceContext | null> = [];
  let beep = deferred<void>();
  let ambianceDone = deferred<AmbianceContext>();

  const adapter: RecorderAdapter = createRecorderAdapter({
    sink: (fact) => facts.push(fact),
    tuning: { deadMicMs: DEAD_MIC_MS, drainMs: DRAIN_MS },
    timers,
    ambiance: {
      begin: () => {
        beep = deferred<void>();
        ambianceDone = deferred<AmbianceContext>();
        return { beepGate: beep.promise, done: ambianceDone.promise };
      },
      end: (_session, context) => {
        ambianceEnds.push(context);
      },
    },
    custody: {
      open: async (session, audioFile) =>
        void custodyCalls.push(`open:${session}:${audioFile}`),
      markAudible: async (session) =>
        void custodyCalls.push(`audible:${session}`),
      enrich: async (session, fields) =>
        void custodyCalls.push(`enrich:${session}:${fields.duration}`),
    },
    feed: (session, chunk) => feeds.push({ session, length: chunk.length }),
    audioFilePathFor: (session) => `/audio/${session}.wav`,
    createWavWriter: () => {
      const writer = new FakeWriter();
      writers.push(writer);
      return writer;
    },
  });

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const openBeepGate = async () => {
    beep.resolve();
    await settle();
  };
  const frames = (length: number, value = 0) =>
    new Float32Array(length).fill(value);

  return {
    adapter,
    facts,
    feeds,
    custodyCalls,
    timers,
    writers,
    ambianceEnds,
    openBeepGate,
    resolveAmbiance: async (context: AmbianceContext) => {
      ambianceDone.resolve(context);
      await settle();
    },
    settle,
    frames,
  };
}

/** start → captureStarted → past the beep window: ready to record. */
async function driveToCapturing(h: ReturnType<typeof makeHarness>) {
  h.adapter.start("s1");
  await h.openBeepGate();
  h.adapter.captureStarted("s1", { name: "Built-in Mic" });
}

describe("lifecycle recorder adapter", () => {
  it("reports recorderReady on capture confirmation, not on start", async () => {
    const h = makeHarness();
    h.adapter.start("s1");
    expect(h.facts).toEqual([]);
    h.adapter.captureStarted("s1", { name: "Built-in Mic" });
    expect(h.facts).toEqual([{ type: "recorderReady", session: "s1" }]);
    expect(h.adapter.getActiveMicrophone()).toEqual({ name: "Built-in Mic" });
    expect(h.timers.armedDurations()).toEqual([DEAD_MIC_MS]);
  });

  it("fires noAudioDetected when no frames arrive within the dead-mic bound", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    h.timers.fire(DEAD_MIC_MS);
    expect(h.facts).toContainEqual({ type: "noAudioDetected", session: "s1" });
  });

  it("any frame defuses the dead-mic watchdog — silence is not a dead mic", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0), false);
    expect(h.timers.armedDurations()).toEqual([]);
    expect(h.facts.some((f) => f.type === "noAudioDetected")).toBe(false);
  });

  it("opens custody at the first frame and marks audible only on signal", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.001), false);
    await h.settle();
    expect(h.custodyCalls).toEqual(["open:s1:/audio/s1.wav"]);

    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), false);
    await h.settle();
    expect(h.custodyCalls).toEqual(["open:s1:/audio/s1.wav", "audible:s1"]);
    expect(h.writers[0].appended).toHaveLength(2);
    expect(h.feeds).toEqual([
      { session: "s1", length: 160 },
      { session: "s1", length: 160 },
    ]);
  });

  it("drops beep-window frames but never the final chunk", async () => {
    const h = makeHarness();
    h.adapter.start("s1");
    h.adapter.captureStarted("s1", {});
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), false);
    expect(h.feeds).toEqual([]);
    expect(h.writers).toHaveLength(0);

    await h.openBeepGate();
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), false);
    expect(h.feeds).toHaveLength(1);
    expect(h.writers).toHaveLength(1);
  });

  it("drains to recorderClosed exactly once on the final chunk", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    await h.adapter.handleAudioChunk("s1", h.frames(16000, 0.5), false);
    h.adapter.stop("s1");
    expect(h.timers.armedDurations()).toEqual([DRAIN_MS]);

    // Non-final frames during the drain are not accumulated (v1 semantics).
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), false);
    await h.adapter.handleAudioChunk("s1", h.frames(16000, 0.5), true);
    await h.settle();

    expect(h.facts.filter((f) => f.type === "recorderClosed")).toEqual([
      { type: "recorderClosed", session: "s1" },
    ]);
    expect(h.writers[0].finalized).toBe(true);
    expect(h.writers[0].appended).toHaveLength(2);
    expect(h.custodyCalls).toContain("enrich:s1:2");
    expect(h.timers.armedDurations()).toEqual([]);

    // A tardy final chunk changes nothing.
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), true);
    expect(h.facts.filter((f) => f.type === "recorderClosed")).toHaveLength(1);
  });

  it("the drain bound closes custody with the audio already held", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    await h.adapter.handleAudioChunk("s1", h.frames(16000, 0.5), false);
    h.adapter.stop("s1");
    h.timers.fire(DRAIN_MS);
    await h.settle();

    expect(h.facts).toContainEqual({ type: "recorderClosed", session: "s1" });
    expect(h.writers[0].finalized).toBe(true);
    expect(h.custodyCalls).toContain("enrich:s1:1");
  });

  it("stop before capture confirmation closes without a drain", async () => {
    const h = makeHarness();
    h.adapter.start("s1");
    h.adapter.stop("s1");
    expect(h.facts).toEqual([{ type: "recorderClosed", session: "s1" }]);
    expect(h.timers.armedDurations()).toEqual([]);
    expect(h.ambianceEnds).toHaveLength(1);
  });

  it("capture failure reports recorderFailed and ends ambiance", async () => {
    const h = makeHarness();
    h.adapter.start("s1");
    await h.resolveAmbiance({ systemAudioMuted: true, soundsMuted: false });
    h.adapter.captureStartFailed("s1", "MIC_PERMISSION_DENIED");

    expect(h.facts).toContainEqual({
      type: "recorderFailed",
      session: "s1",
      cause: "MIC_PERMISSION_DENIED",
    });
    expect(h.ambianceEnds).toEqual([
      { systemAudioMuted: true, soundsMuted: false },
    ]);
  });

  it("ambiance ends exactly once across stop and close", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    await h.resolveAmbiance({ systemAudioMuted: false, soundsMuted: true });
    h.adapter.stop("s1");
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), true);
    await h.settle();
    expect(h.ambianceEnds).toEqual([
      { systemAudioMuted: false, soundsMuted: true },
    ]);
  });

  it("fences traffic from stale sessions", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    h.adapter.captureStarted("s0", { name: "Ghost" });
    await h.adapter.handleAudioChunk("s0", h.frames(160, 0.5), false);
    h.adapter.stop("s0");
    h.adapter.captureStartFailed("s0", "LATE");

    expect(h.facts).toEqual([{ type: "recorderReady", session: "s1" }]);
    expect(h.writers).toHaveLength(0);
    expect(h.feeds).toEqual([]);

    // A successor start retires the previous capture state entirely.
    h.adapter.start("s2");
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), false);
    expect(h.writers).toHaveLength(0);
  });

  it("ignores empty frames except as the final-chunk marker", async () => {
    const h = makeHarness();
    await driveToCapturing(h);
    await h.adapter.handleAudioChunk("s1", h.frames(0), false);
    expect(h.writers).toHaveLength(0);
    expect(h.timers.armedDurations()).toEqual([DEAD_MIC_MS]);

    h.adapter.stop("s1");
    await h.adapter.handleAudioChunk("s1", h.frames(0), true);
    await h.settle();
    expect(h.facts).toContainEqual({ type: "recorderClosed", session: "s1" });
    // No frames ever flowed: no writer, no custody row, nothing to enrich.
    expect(h.custodyCalls).toEqual([]);
  });

  it("keeps beep-window frames when the gate opens immediately (muted sounds)", async () => {
    const h = makeHarness();
    h.adapter.start("s1");
    await h.openBeepGate(); // muted: gate resolves before any frame
    h.adapter.captureStarted("s1", {});
    await h.adapter.handleAudioChunk("s1", h.frames(160, 0.5), false);
    expect(h.feeds).toHaveLength(1);
    expect(h.writers).toHaveLength(1);
  });
});
