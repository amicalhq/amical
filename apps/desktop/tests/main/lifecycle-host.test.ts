import { describe, expect, it, vi } from "vitest";
import {
  createHostAdapter,
  type PendingDraft,
} from "../../src/main/lifecycle/adapters/host";
import type { LifecyclePortFact } from "../../src/main/lifecycle/ports";

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
}) {
  const facts: LifecyclePortFact[] = [];
  const pastes: Array<{ transcript: string; preserveClipboard: boolean }> = [];
  const enterMasks: boolean[] = [];
  const inputArms: boolean[] = [];
  const draftChanges: Array<PendingDraft | null> = [];
  let idle = false;

  const adapter = createHostAdapter({
    sink: (fact) => facts.push(fact),
    bridge: options?.bridgeless
      ? null
      : {
          pasteText: async (paste) => {
            pastes.push(paste);
          },
          setDraftEnterCapture: async (armed) => {
            enterMasks.push(armed);
          },
        },
    getPreserveClipboard: async () => true,
    isDraftSession: (session) => options?.draftSessions?.has(session) ?? false,
    isLifecycleIdle: () => idle,
    setDraftInputActive: (armed) => inputArms.push(armed),
  });
  adapter.onDraftChanged((draft) => draftChanges.push(draft));

  return {
    adapter,
    facts,
    pastes,
    enterMasks,
    inputArms,
    draftChanges,
    setIdle(value: boolean) {
      idle = value;
      adapter.syncDraftEnterMask();
    },
  };
}

describe("lifecycle host adapter", () => {
  it("stages a plain success as a paste and reports deliveryStaged", async () => {
    const h = makeHarness();
    h.adapter.stageDelivery("s1", { kind: "success", text: "hello" });
    await settle();

    expect(h.pastes).toEqual([
      { transcript: "hello", preserveClipboard: true },
    ]);
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
    expect(h.adapter.getPendingDraft()).toBeNull();
  });

  it("stages a draft success into the pending draft without pasting", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1"]) });
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
    h.adapter.stageDelivery("s1", { kind: "dismissed" });
    await settle();
    expect(h.pastes).toEqual([]);
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
  });

  it("still reports deliveryStaged when no bridge is available", async () => {
    const h = makeHarness({ bridgeless: true });
    h.adapter.stageDelivery("s1", { kind: "success", text: "hello" });
    await settle();
    expect(h.facts).toEqual([{ type: "deliveryStaged", session: "s1" }]);
  });

  it("confirmDraft pastes the held text once and clears the draft", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1"]) });
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
    h.adapter.stageDelivery("s1", { kind: "success", text: "held" });
    await settle();

    h.adapter.dismissDraft();
    expect(h.adapter.getPendingDraft()).toBeNull();
    expect(h.pastes).toEqual([]);
    expect(h.draftChanges.at(-1)).toBeNull();
  });

  it("a new draft replaces the previous one", async () => {
    const h = makeHarness({ draftSessions: new Set(["s1", "s2"]) });
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
