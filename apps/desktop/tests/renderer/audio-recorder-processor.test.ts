import { describe, it, expect, beforeAll } from "vitest";

interface PostedFrame {
  type: string;
  frame: Float32Array;
  isFinal: boolean;
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
let ProcessorClass: new () => Processor;

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

function makeProcessor() {
  const inst = new ProcessorClass();
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
