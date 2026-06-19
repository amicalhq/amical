import { describe, expect, it } from "vitest";
import { createManager, flush } from "./shortcut-manager-test-utils";

// Abstract keycodes for these tests.
const FN = 201;
const CTRL = 202;
const X = 203;
const Y = 204;

// Configure PTT + draft bindings. draftMode is a real ShortcutConfig field but
// isn't in the shared internals helper type, so set shortcuts directly here.
const useDraftBinding = (
  internals: unknown,
  ptt: number[],
  draft: number[],
) => {
  (internals as { shortcuts: Record<string, number[]> }).shortcuts = {
    pushToTalk: ptt,
    toggleRecording: [],
    pasteLastTranscript: [],
    newNote: [],
    draftMode: draft,
  };
};

describe("ShortcutManager draft binding (second PTT binding)", () => {
  it("adding the draft modifier to a held PTT chord keeps recording and tags draft", async () => {
    // The regression this fixes: with PTT=Fn and draft=Fn+Ctrl, pressing Ctrl
    // after Fn used to emit a PTT release (the old mask) and STOP the recording.
    const { manager, internals, timeline } = createManager();
    useDraftBinding(internals, [FN], [FN, CTRL]);

    internals.addActiveKey(FN); // {Fn} → normal PTT press
    expect(timeline).toEqual(["press"]);
    expect(manager.isPTTDraftActive()).toBe(false);

    internals.addActiveKey(CTRL); // {Fn,Ctrl} → stays pressed (NO release), now draft
    expect(timeline).toEqual(["press"]);
    expect(manager.isPTTDraftActive()).toBe(true);

    internals.removeActiveKey(CTRL); // {Fn} → sustains on base PTT chord
    expect(timeline).toEqual(["press"]);

    internals.removeActiveKey(FN); // {} → single release
    expect(timeline).toEqual(["press", "release"]);
    expect(manager.isPTTDraftActive()).toBe(false);

    await flush();
  });

  it("plain PTT (no draft modifier) is not tagged draft", async () => {
    const { manager, internals, timeline } = createManager();
    useDraftBinding(internals, [FN], [FN, CTRL]);

    internals.addActiveKey(FN);
    expect(timeline).toEqual(["press"]);
    expect(manager.isPTTDraftActive()).toBe(false);

    internals.removeActiveKey(FN);
    expect(timeline).toEqual(["press", "release"]);

    await flush();
  });

  it("a non-overlapping draft chord latches, sustains, and tags draft", async () => {
    const { manager, internals, timeline } = createManager();
    useDraftBinding(internals, [FN], [X, Y]);

    internals.addActiveKey(X); // {X} → neither chord exact
    expect(timeline).toEqual([]);

    internals.addActiveKey(Y); // {X,Y} → exact draft → press + draft tag
    expect(timeline).toEqual(["press"]);
    expect(manager.isPTTDraftActive()).toBe(true);

    internals.removeActiveKey(Y); // {X} → neither chord fully held → release
    expect(timeline).toEqual(["press", "release"]);
    expect(manager.isPTTDraftActive()).toBe(false);

    await flush();
  });
});
