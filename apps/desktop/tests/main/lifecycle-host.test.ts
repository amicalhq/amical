import { describe, expect, it, vi } from "vitest";
import {
  createHostAdapter,
  type PendingDraft,
} from "../../src/main/lifecycle/adapters/host";
import { createSessionWork } from "../../src/main/lifecycle/effect/session-work";
import type { LifecyclePortFact } from "../../src/main/lifecycle/ports";
import { FakeTimers } from "../helpers/lifecycle-fakes";

const { getLatestTranscription } = vi.hoisted(() => ({
  getLatestTranscription: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("../../src/db/transcriptions", () => ({
  getLatestTranscription,
}));

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeHarness(options?: {
  draftSessions?: Set<string>;
  bridgeless?: boolean;
  getPreserveClipboard?: () => Promise<boolean>;
}) {
  const facts: LifecyclePortFact[] = [];
  const pastes: Array<{ transcript: string; preserveClipboard: boolean }> = [];
  const enterMasks: boolean[] = [];
  const inputArms: boolean[] = [];
  const draftChanges: Array<PendingDraft | null> = [];
  let idle = false;

  // Sessions are opened by the runtime at admission; the standalone harness
  // does it explicitly per test via h.open().
  const sessionWork = createSessionWork({ timers: new FakeTimers() });

  const adapter = createHostAdapter({
    sink: (fact) => facts.push(fact),
    bridge: options?.bridgeless
      ? null
      : {
          pasteText: async (paste) => {
            pastes.push(paste);
            return { success: true };
          },
          setDraftEnterCapture: async (armed) => {
            enterMasks.push(armed);
          },
        },
    getPreserveClipboard: options?.getPreserveClipboard ?? (async () => true),
    sessionWork,
    isDraftSession: (session) => options?.draftSessions?.has(session) ?? false,
    isLifecycleIdle: () => idle,
    setDraftInputActive: (armed) => inputArms.push(armed),
  });
  adapter.onDraftChanged((draft) => draftChanges.push(draft));

  return {
    adapter,
    sessionWork,
    facts,
    pastes,
    enterMasks,
    inputArms,
    draftChanges,
    open(...sessions: string[]) {
      for (const session of sessions) sessionWork.open(session);
    },
    setIdle(value: boolean) {
      idle = value;
      adapter.syncDraftEnterMask();
    },
  };
}

describe("lifecycle host adapter", () => {
  it("stages a plain success as a paste and reports deliveryStaged", async () => {
    const h = makeHarness();
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "hello" });
    await settle();

    expect(h.pastes).toEqual([
      { transcript: "hello", preserveClipboard: true },
    ]);
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
    expect(h.adapter.getPendingDraft()).toBeNull();
  });

  it("an abandoned session stages nothing but still reports the fact", async () => {
    const h = makeHarness();
    h.open("s1", "s2");
    h.adapter.abandon("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "quarantined" });
    await settle();

    expect(h.pastes).toEqual([]);
    expect(h.adapter.getPendingDraft()).toBeNull();
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);

    // A successor session is unaffected.
    h.adapter.stageDelivery("s2", { kind: "success", text: "next" });
    await settle();
    expect(h.pastes).toEqual([{ transcript: "next", preserveClipboard: true }]);
  });

  it("stages a draft success into the pending draft without pasting", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1"]) });
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "draft text" });
    await settle();

    expect(h.pastes).toEqual([]);
    expect(h.adapter.getPendingDraft()).toEqual({
      sessionId: "s1",
      text: "draft text",
    });
    expect(h.draftChanges).toEqual([{ sessionId: "s1", text: "draft text" }]);
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
  });

  it("stages non-delivering outcomes defensively without side effects", async () => {
    const h = makeHarness();
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "dismissed" });
    await settle();
    expect(h.pastes).toEqual([]);
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
  });

  it("still reports deliveryStaged when no bridge is available", async () => {
    const h = makeHarness({ bridgeless: true });
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "hello" });
    await settle();
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
  });

  it("confirmDraft pastes the held text once and clears the draft", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1"]) });
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "held" });
    await settle();

    await h.adapter.confirmDraft();
    await settle();
    expect(h.pastes).toEqual([{ transcript: "held", preserveClipboard: true }]);
    expect(h.adapter.getPendingDraft()).toBeNull();

    // A second confirm has nothing to paste.
    await h.adapter.confirmDraft();
    await settle();
    expect(h.pastes).toHaveLength(1);
  });

  it("dismissDraft clears without pasting", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1"]) });
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "held" });
    await settle();

    h.adapter.dismissDraft();
    expect(h.adapter.getPendingDraft()).toBeNull();
    expect(h.pastes).toEqual([]);
    expect(h.draftChanges.at(-1)).toBeNull();
  });

  it("a new draft replaces the previous one", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1", "s2"]) });
    h.open("s1", "s2");
    h.adapter.stageDelivery("s1", { kind: "success", text: "first" });
    await settle();
    h.adapter.stageDelivery("s2", { kind: "success", text: "second" });
    await settle();
    expect(h.adapter.getPendingDraft()).toEqual({
      sessionId: "s2",
      text: "second",
    });
  });

  it("arms the Enter mask only while a draft is reviewable and idle", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1"]) });
    // Draft staged while still SETTLING (not idle): mask must stay off.
    h.adapter.stageDelivery("s1", { kind: "success", text: "held" });
    await settle();
    expect(h.inputArms).toEqual([]);

    // Lifecycle reaches idle: mask arms (single flip).
    h.setIdle(true);
    h.setIdle(true);
    expect(h.inputArms).toEqual([true]);
    expect(h.enterMasks).toEqual([true]);

    // Re-dictation starts: mask disarms while not idle.
    h.setIdle(false);
    expect(h.inputArms).toEqual([true, false]);

    // Dismissing while idle keeps it off (no draft to arm for).
    h.setIdle(true);
    h.adapter.dismissDraft();
    expect(h.inputArms).toEqual([true, false, true, false]);
  });

  it("pastes the latest non-empty transcription on request", async () => {
    const h = makeHarness();
    getLatestTranscription.mockResolvedValueOnce({ text: "  " });
    await h.adapter.pasteLatestTranscription();
    expect(h.pastes).toEqual([]);

    getLatestTranscription.mockResolvedValueOnce({ text: "previous words" });
    await h.adapter.pasteLatestTranscription();
    await settle();
    expect(h.pastes).toEqual([
      { transcript: "previous words", preserveClipboard: true },
    ]);
  });
});

describe("R9-1: staging retirement fences the paste", () => {
  it("a preference read that outlives the session cannot paste late", async () => {
    let resolveRead!: (value: boolean) => void;
    const h = makeHarness({
      getPreserveClipboard: () =>
        new Promise<boolean>((resolve) => {
          resolveRead = resolve;
        }),
    });
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "stale words" });
    await settle();
    // The paste span is parked on the preference read; the fact has not
    // fired yet (the staging obligation is still running).
    expect(h.facts).toEqual([]);

    // Staging expiry: the machine reaches IDLE and the runtime retires the
    // session. The span dies at its await.
    h.sessionWork.retire("s1");
    await h.sessionWork.settled();
    // The obligation absorbed the interruption and still emitted its fact.
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);

    // The read finally resolves: nothing may paste.
    resolveRead(true);
    await settle();
    expect(h.pastes).toEqual([]);
  });

  it("abandon during the preference read stops the paste (R10)", async () => {
    let resolveRead!: (value: boolean) => void;
    const h = makeHarness({
      getPreserveClipboard: () =>
        new Promise<boolean>((resolve) => {
          resolveRead = resolve;
        }),
    });
    h.open("s1");
    h.adapter.stageDelivery("s1", { kind: "success", text: "wedged" });
    await settle();

    h.adapter.abandon("s1");
    resolveRead(true);
    await h.sessionWork.settled();
    await settle();
    expect(h.pastes).toEqual([]);
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
  });
});
