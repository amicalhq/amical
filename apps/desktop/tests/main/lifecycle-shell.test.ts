import { describe, expect, it } from "vitest";
import {
  createLifecycleShell,
  type LifecycleShell,
  type LifecycleSnapshot,
} from "../../src/main/lifecycle/shell";
import { FakeTimers } from "../helpers/lifecycle-fakes";
import type {
  LifecycleFactSink,
  LifecyclePorts,
} from "../../src/main/lifecycle/ports";
import type { LifecycleTuning } from "../../src/main/lifecycle/tuning";
import type {
  LifecycleCommand,
  SealedOutcome,
} from "../../src/main/lifecycle/types";

/** Distinct per-stage values so arming asserts the right bound was read. */
const TUNING: LifecycleTuning = {
  stageBoundsMs: {
    starting: 11,
    recording: 22,
    resolving: 33,
    committing: 44,
    staging: 55,
  },
  deadMicMs: 5,
  drainMs: 6,
  pressWindowMs: 1,
  quickWindowMs: 1,
  longRecordingReminderMs: 99,
  commitRepairDelayMs: 66,
  emptyNoticeMinRecordingMs: 8,
};

type Meta = { mode: string; isDraft: boolean };

interface Harness {
  shell: LifecycleShell<Meta>;
  timers: FakeTimers;
  calls: string[];
  snapshots: LifecycleSnapshot<Meta>[];
  portErrors: LifecycleCommand[];
  emit: LifecycleFactSink;
}

function sealedText(sealed: SealedOutcome): string {
  return sealed.kind === "success"
    ? `${sealed.kind}:${sealed.text}`
    : sealed.kind;
}

function makeHarness(
  portOverrides: (
    calls: string[],
    sink: () => LifecycleFactSink,
  ) => Partial<LifecyclePorts> = () => ({}),
): Harness {
  const calls: string[] = [];
  const snapshots: LifecycleSnapshot<Meta>[] = [];
  const portErrors: LifecycleCommand[] = [];
  const timers = new FakeTimers();
  let mint = 0;
  let sink: LifecycleFactSink = () => {
    throw new Error("sink used before shell construction");
  };
  const getSink = () => (fact: Parameters<LifecycleFactSink>[0]) => sink(fact);

  const shell = createLifecycleShell<Meta>({
    tuning: TUNING,
    timers,
    mintSession: () => `s${++mint}`,
    ports: (factSink) => {
      sink = factSink;
      const defaults: LifecyclePorts = {
        recorder: {
          start: (session) => calls.push(`recorder.start:${session}`),
          stop: (session) => calls.push(`recorder.stop:${session}`),
        },
        transcription: {
          finalize: (session) => calls.push(`stt.finalize:${session}`),
          cancel: (session) => calls.push(`stt.cancel:${session}`),
        },
        storage: {
          commit: (session, sealed) =>
            calls.push(`storage.commit:${session}:${sealedText(sealed)}`),
        },
        host: {
          stageDelivery: (session, sealed) =>
            calls.push(`host.stage:${session}:${sealedText(sealed)}`),
        },
      };
      return { ...defaults, ...portOverrides(calls, getSink) };
    },
    onPortError: (command) => portErrors.push(command),
  });
  shell.onSnapshot((snapshot) => snapshots.push(snapshot));
  return { shell, timers, calls, snapshots, portErrors, emit: getSink() };
}

const META: Meta = { mode: "ptt", isDraft: false };

function driveToRecording(h: Harness): string {
  const session = h.shell.requestStart(META);
  h.emit({ type: "recorderReady", session });
  return session;
}

describe("lifecycle shell", () => {
  it("routes the happy path through the ports in contract order", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.shell.requestStop();
    h.emit({ type: "recorderClosed", session: s });
    h.emit({
      type: "transcriptionFinal",
      session: s,
      result: { kind: "text", text: "hello" },
    });
    h.emit({ type: "storageFinished", session: s });
    h.emit({ type: "deliveryStaged", session: s });

    expect(h.calls).toEqual([
      `recorder.start:${s}`,
      `recorder.stop:${s}`,
      `stt.finalize:${s}`,
      `storage.commit:${s}:success:hello`,
      `host.stage:${s}:success:hello`,
    ]);
    expect(h.shell.getState()).toEqual({ tag: "IDLE" });
    expect(h.shell.getSnapshot()).toMatchObject({
      sessionId: null,
      metadata: null,
      projection: { publicState: "idle", terminal: null },
    });
    expect(h.timers.armedDurations()).toEqual([]);
  });

  it("publishes projections between commit and dispatch, with metadata", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    expect(h.snapshots.map((x) => x.projection.publicState)).toEqual([
      "starting",
      "recording",
    ]);
    expect(h.snapshots.at(-1)).toMatchObject({
      sessionId: s,
      metadata: META,
    });
    h.shell.requestStop();
    expect(h.snapshots.at(-1)?.projection).toMatchObject({
      publicState: "stopping",
      stopKind: "finalize",
      stopOrigin: "user",
    });
  });

  it("arms exactly one bound per stage and rotates them on transitions", () => {
    const h = makeHarness();
    h.shell.requestStart(META);
    expect(h.timers.armedDurations()).toEqual([11]);
    h.emit({ type: "recorderReady", session: "s1" });
    expect(h.timers.armedDurations()).toEqual([22]);
    h.shell.requestStop();
    expect(h.timers.armedDurations()).toEqual([33]);
    h.emit({ type: "recorderClosed", session: "s1" });
    // Same stage, same session: the resolving bound must NOT re-arm.
    expect(h.timers.armedDurations()).toEqual([33]);
    h.emit({
      type: "transcriptionFinal",
      session: "s1",
      result: { kind: "text", text: "t" },
    });
    expect(h.timers.armedDurations()).toEqual([44]);
    h.emit({ type: "storageFinished", session: "s1" });
    expect(h.timers.armedDurations()).toEqual([55]);
    h.emit({ type: "deliveryStaged", session: "s1" });
    expect(h.timers.armedDurations()).toEqual([]);
  });

  it("seals failure(timeout) when the resolving bound fires", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.shell.requestStop();
    h.emit({ type: "recorderClosed", session: s });
    h.timers.fireOnly();
    expect(h.shell.getSnapshot().projection.terminal).toEqual({
      kind: "failure",
      cause: "timeout",
    });
    expect(h.calls).toContain(`storage.commit:${s}:failure`);
  });

  it("advances past a hung commit when the commit grace fires (R7)", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.shell.requestStop();
    h.emit({ type: "recorderClosed", session: s });
    h.emit({
      type: "transcriptionFinal",
      session: s,
      result: { kind: "text", text: "t" },
    });
    // storageFinished never arrives; the committing bound degrades forward.
    h.timers.fireOnly();
    expect(h.calls).toContain(`host.stage:${s}:success:t`);
    expect(h.timers.armedDurations()).toEqual([55]);
  });

  it("auto-stops at the recording cap with stopOrigin=auto", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.timers.fireOnly();
    expect(h.calls).toContain(`recorder.stop:${s}`);
    expect(h.shell.getSnapshot().projection).toMatchObject({
      publicState: "stopping",
      stopOrigin: "auto",
    });
  });

  it("seals discard(no_audio) on the dead-mic fact", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.emit({ type: "noAudioDetected", session: s });
    expect(h.calls.slice(1)).toEqual([
      `recorder.stop:${s}`,
      `stt.cancel:${s}`,
      `storage.commit:${s}:discard`,
    ]);
    expect(h.shell.getSnapshot().projection.stopKind).toBe("dismiss");
  });

  it("refuses admission while busy without disturbing the live session", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    const callCount = h.calls.length;
    const snapshotCount = h.snapshots.length;
    const refused = h.shell.requestStart({ mode: "toggle", isDraft: false });
    expect(refused).not.toBe(s);
    expect(h.calls).toHaveLength(callCount);
    expect(h.snapshots).toHaveLength(snapshotCount);
    expect(h.shell.getSnapshot().metadata).toEqual(META);
  });

  it("fences stale facts from a retired session at the shell boundary", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.emit({ type: "noAudioDetected", session: s });
    h.emit({ type: "storageFinished", session: s });
    expect(h.shell.getState()).toEqual({ tag: "IDLE" });
    const calls = h.calls.length;
    // Laggard facts from the retired session must change nothing.
    h.emit({ type: "recorderClosed", session: s });
    h.emit({
      type: "transcriptionFinal",
      session: s,
      result: { kind: "text", text: "late" },
    });
    expect(h.calls).toHaveLength(calls);
    expect(h.shell.getState()).toEqual({ tag: "IDLE" });
  });

  it("serializes re-entrant facts emitted during command routing", () => {
    // recorder.stop reports the drain synchronously — the fact must queue
    // behind the in-flight event, not interleave into it.
    const h = makeHarness((calls, sink) => ({
      recorder: {
        start: (session) => calls.push(`recorder.start:${session}`),
        stop: (session) => {
          calls.push(`recorder.stop:${session}`);
          sink()({ type: "recorderClosed", session });
        },
      },
    }));
    const s = driveToRecording(h);
    h.shell.requestStop();
    expect(h.calls).toEqual([
      `recorder.start:${s}`,
      `recorder.stop:${s}`,
      `stt.finalize:${s}`,
    ]);
    expect(h.shell.getState()).toMatchObject({
      tag: "RESOLVING",
      recorderClosed: true,
    });
  });

  it("keeps draining when a port throws, reporting the failed command", () => {
    const h = makeHarness(() => ({
      storage: {
        commit: () => {
          throw new Error("db locked");
        },
      },
    }));
    const s = driveToRecording(h);
    h.shell.requestStop();
    h.emit({ type: "recorderClosed", session: s });
    h.emit({
      type: "transcriptionFinal",
      session: s,
      result: { kind: "text", text: "t" },
    });
    expect(h.portErrors).toEqual([
      {
        type: "commitDisposition",
        session: s,
        sealed: { kind: "success", text: "t" },
      },
    ]);
    // The commit fact never arrives; the grace bound still degrades forward.
    h.timers.fireOnly();
    expect(h.calls).toContain(`host.stage:${s}:success:t`);
  });

  it("applies quick-release cancel only where the contract allows it", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.shell.requestStop();
    const calls = h.calls.length;
    h.shell.requestCancel("quick_release");
    expect(h.calls).toHaveLength(calls);
    expect(h.shell.getState()).toMatchObject({ tag: "RESOLVING" });

    // In RECORDING it seals discard(quick_release).
    h.emit({ type: "recorderClosed", session: s });
    h.emit({
      type: "transcriptionFinal",
      session: s,
      result: { kind: "empty" },
    });
    h.emit({ type: "storageFinished", session: s });
    const h2 = makeHarness();
    const s2 = driveToRecording(h2);
    h2.shell.requestCancel("quick_release");
    expect(h2.shell.getSnapshot().projection.terminal).toEqual({
      kind: "discard",
      reason: "quick_release",
    });
    expect(h2.calls).toContain(`storage.commit:${s2}:discard`);
  });

  it("merges metadata into the live session only, and publishes the change", () => {
    const h = makeHarness();
    h.shell.updateMetadata({ isDraft: true });
    expect(h.snapshots).toHaveLength(0);

    driveToRecording(h);
    const snapshots = h.snapshots.length;
    h.shell.updateMetadata({ isDraft: true });
    expect(h.snapshots).toHaveLength(snapshots + 1);
    expect(h.shell.getSnapshot().metadata).toEqual({
      mode: "ptt",
      isDraft: true,
    });
  });

  it("forceReset returns to IDLE, clears bounds, and tears down ports", () => {
    const h = makeHarness();
    const s = driveToRecording(h);
    h.shell.forceReset();
    expect(h.shell.getState()).toEqual({ tag: "IDLE" });
    expect(h.timers.armedDurations()).toEqual([]);
    expect(h.calls).toContain(`recorder.stop:${s}`);
    expect(h.calls).toContain(`stt.cancel:${s}`);
    expect(h.shell.getSnapshot()).toMatchObject({
      sessionId: null,
      metadata: null,
    });
  });

  it("ignores verbs when idle instead of stamping phantom sessions", () => {
    const h = makeHarness();
    h.shell.requestStop();
    h.shell.requestDismiss();
    h.shell.requestCancel("quick_release");
    expect(h.calls).toEqual([]);
    expect(h.snapshots).toEqual([]);
    expect(h.shell.getState()).toEqual({ tag: "IDLE" });
  });

  it("a fresh session is admitted immediately after the previous one settles", () => {
    const h = makeHarness();
    const s1 = driveToRecording(h);
    h.emit({ type: "noAudioDetected", session: s1 });
    h.emit({ type: "storageFinished", session: s1 });
    expect(h.shell.getState()).toEqual({ tag: "IDLE" });

    const s2 = h.shell.requestStart({ mode: "hands-free", isDraft: false });
    expect(h.calls).toContain(`recorder.start:${s2}`);
    expect(h.shell.getSnapshot().metadata).toEqual({
      mode: "hands-free",
      isDraft: false,
    });
  });
});
