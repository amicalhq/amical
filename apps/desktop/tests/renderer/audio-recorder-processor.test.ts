import { describe, it, expect, beforeAll } from "vitest";

interface PostedFrame {
  type: string;
  frame: Float32Array;
  isFinal: boolean;
  inputChannelCount: number;
}

interface Processor {
  port: {
    postMessage: (msg: PostedFrame) => void;
    onmessage: ((event: { data: { type: string } }) => void) | null;
  };
  process: (
    inputs: Float32Array[][],
    outputs: unknown,
    params: unknown,
  ) => boolean;
}

// The worklet module references AudioWorkletProcessor / registerProcessor at load
// time and does not export its class. Define the globals first, then capture the
// registered class via a mocked registerProcessor.
type ProcessorOptions = { processorOptions: { stereoDownmixEnabled: boolean } };
let ProcessorClass: new (options?: ProcessorOptions) => Processor;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).AudioWorkletProcessor = class {
    port = { postMessage: () => {}, onmessage: null };
  };
  (globalThis as Record<string, unknown>).sampleRate = 16000;
  (globalThis as Record<string, unknown>).registerProcessor = (
    _name: string,
    cls: new () => Processor,
  ) => {
    ProcessorClass = cls;
  };
  // The worklet asset has no exports; it self-registers via the global
  // registerProcessor stub above and is imported only for that side effect.
  // @ts-expect-error non-module asset imported for its registerProcessor side effect
  await import("@/assets/audio-recorder-processor.js");
});

function makeProcessor(stereoDownmixEnabled = true) {
  const inst = new ProcessorClass({
    processorOptions: { stereoDownmixEnabled },
  });
  const posted: PostedFrame[] = [];
  inst.port.postMessage = (msg) => posted.push(msg);
  return { inst, posted };
}

// Ascending ramp so frame boundaries / ordering are easy to assert. Values stay
// well under 2^24, so they round-trip exactly through Float32.
function ramp(length: number, start = 0): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = start + i;
  return out;
}

function feed(inst: Processor, samples: Float32Array): boolean {
  return inst.process([[samples]], [], {});
}

function flush(inst: Processor): void {
  inst.port.onmessage?.({ data: { type: "flush" } });
}

describe("audio-recorder-processor worklet", () => {
  it("retains right-only stereo speech at half amplitude and reports both input channels", () => {
    const { inst, posted } = makeProcessor();
    inst.process(
      [[new Float32Array(512), new Float32Array(512).fill(0.5)]],
      [],
      {},
    );
    expect(posted[0].frame).toEqual(new Float32Array(512).fill(0.25));
    expect(posted[0].inputChannelCount).toBe(2);
  });

  it("preserves mono and duplicated stereo samples without changing gain", () => {
    const samples = ramp(512);
    for (const channels of [[samples], [samples, samples]]) {
      const { inst, posted } = makeProcessor();
      inst.process([channels], [], {});
      expect(posted[0].frame).toEqual(samples);
      expect(posted[0].inputChannelCount).toBe(channels.length);
    }
  });

  it("uses a fixed mean even when the louder stereo channel changes", () => {
    const { inst, posted } = makeProcessor();
    const left = Float32Array.from({ length: 512 }, (_, i) =>
      i % 2 ? 0.25 : 0.75,
    );
    const right = Float32Array.from(left, (value) => 1 - value);
    inst.process([[left, right]], [], {});
    expect(posted[0].frame).toEqual(new Float32Array(512).fill(0.5));
  });

  it("restores first-channel capture when the remote control is disabled", () => {
    const { inst, posted } = makeProcessor(false);
    const first = new Float32Array(512).fill(0.25);
    inst.process([[first, new Float32Array(512).fill(0.75)]], [], {});
    expect(posted[0].frame).toEqual(first);
    expect(posted[0].inputChannelCount).toBe(2);
  });

  it("does not mix additional interface or loopback channels", () => {
    const { inst, posted } = makeProcessor();
    const first = new Float32Array(512).fill(0.25);
    inst.process(
      [[first, new Float32Array(512), new Float32Array(512).fill(1)]],
      [],
      {},
    );
    expect(posted[0].frame).toEqual(first);
    expect(posted[0].inputChannelCount).toBe(3);
  });

  it("reports the channel count on a short final frame", () => {
    const { inst, posted } = makeProcessor();
    inst.process(
      [[new Float32Array(64), new Float32Array(64).fill(0.5)]],
      [],
      {},
    );
    flush(inst);
    expect(posted[0].frame).toEqual(new Float32Array(64).fill(0.25));
    expect(posted[0].inputChannelCount).toBe(2);
    expect(posted[0].isFinal).toBe(true);
  });

  it("buffers sub-frame input and emits nothing until it has a full 512-sample frame", () => {
    const { inst, posted } = makeProcessor();
    feed(inst, ramp(300));
    expect(posted).toHaveLength(0);
    feed(inst, ramp(300, 300));
    expect(posted).toHaveLength(1);
    expect(posted[0].isFinal).toBe(false);
    expect(posted[0].frame).toHaveLength(512);
  });

  it("emits contiguous 512-sample frames and keeps the remainder buffered", () => {
    const { inst, posted } = makeProcessor();
    feed(inst, ramp(1100)); // two full frames (1024) + 76 buffered
    expect(posted).toHaveLength(2);
    expect(posted.every((p) => p.frame.length === 512 && !p.isFinal)).toBe(
      true,
    );
    expect(posted[0].frame[0]).toBe(0);
    expect(posted[1].frame[0]).toBe(512); // contiguous, no gap or overlap
  });

  it("flush emits the buffered remainder as the final frame and clears the buffer", () => {
    const { inst, posted } = makeProcessor();
    feed(inst, ramp(300));
    flush(inst);
    expect(posted).toHaveLength(1);
    expect(posted[0].isFinal).toBe(true);
    expect(posted[0].frame).toHaveLength(300);

    // Buffer cleared: a second flush yields an empty final frame, not the old 300.
    posted.length = 0;
    flush(inst);
    expect(posted).toHaveLength(1);
    expect(posted[0].frame).toHaveLength(0);
  });

  it("flush on an empty buffer still emits exactly one empty final frame", () => {
    const { inst, posted } = makeProcessor();
    flush(inst);
    expect(posted).toHaveLength(1);
    expect(posted[0].isFinal).toBe(true);
    expect(posted[0].frame).toHaveLength(0);
  });

  it("does not bleed audio across dictations: post-flush input is not prepended with stale samples", () => {
    const { inst, posted } = makeProcessor();
    feed(inst, ramp(400, 1)); // values 1..400
    flush(inst); // drains the 400
    posted.length = 0;

    feed(inst, ramp(100, 9000)); // a later utterance on the same instance
    flush(inst);
    expect(posted).toHaveLength(1);
    expect(posted[0].frame).toHaveLength(100); // would be 500 if it bled
    expect(posted[0].frame[0]).toBe(9000); // starts with new audio, no stale 1..400
  });

  it("a fresh processor instance starts empty (the per-dictation-node guarantee)", () => {
    const a = makeProcessor();
    feed(a.inst, ramp(400)); // never flushed; left buffered on instance A

    // The hook creates a brand-new node per dictation; instance B must be empty.
    const b = makeProcessor();
    flush(b.inst);
    expect(b.posted[0].frame).toHaveLength(0);
  });

  it("ignores empty/absent input and keeps the node alive (process returns true)", () => {
    const { inst, posted } = makeProcessor();
    expect(inst.process([], [], {})).toBe(true); // no inputs
    expect(inst.process([[]], [], {})).toBe(true); // input with no channel
    expect(posted).toHaveLength(0);
    expect(feed(inst, ramp(512))).toBe(true); // normal path also returns true
  });
});
