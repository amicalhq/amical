import { describe, expect, it } from "vitest";

import { extractCandidates } from "../../../src/services/vocabulary-learning/candidates";
import {
  createEditTracker,
  isEditingKey,
  isEnterKey,
} from "../../../src/services/vocabulary-learning/edit-tracker";
import type {
  EditTrackerResult,
  KeyDown,
  TrackerPlatform,
  WatchRead,
} from "../../../src/services/vocabulary-learning/types";
import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../../src/utils/keycodes";

// ---------------------------------------------------------------------------
// Harness: fake clock and timers, a field the test edits, a reader that
// answers from the field (or from a scripted queue), and key events that are
// handled one microtask late like the real bridge listener.
//
// Timing note: a key read lands 50 ms after the key, but at least 100 ms
// after the previous read. Edits in these tests happen at x300 ms so they do
// not collide with the periodic read on the 1 s grid.
// ---------------------------------------------------------------------------

interface FakeTimer {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

interface HarnessOptions {
  pasted: string;
  platform?: TrackerPlatform;
  /** Field text at the first read. Defaults to the pasted text alone. */
  text?: string;
  /** Caret offset; null = no selection; default = end of the pasted text. */
  caret?: number | null;
}

function key(keyCode: number, mods: Partial<KeyDown> = {}): KeyDown {
  return {
    keyCode,
    metaKey: false,
    ctrlKey: false,
    ...mods,
  };
}

function createHarness(options: HarnessOptions) {
  const platform = options.platform ?? "darwin";
  const text = options.text ?? options.pasted;
  let now = 0;
  const timers: FakeTimer[] = [];
  const field = {
    text,
    selection:
      options.caret === null
        ? null
        : {
            location:
              options.caret ??
              text.indexOf(options.pasted) + options.pasted.length,
            length: 0,
          },
  };
  const readTimes: number[] = [];
  const queued: WatchRead[] = [];
  let held: Array<() => void> = [];
  let hold = false;
  let resolved: EditTrackerResult | null = null;

  const snapshot = (): WatchRead => ({
    status: "ok",
    text: field.text,
    selection: field.selection,
    readMs: 5,
  });

  const tracker = createEditTracker({
    pastedText: options.pasted,
    platform,
    deps: {
      now: () => now,
      setTimer(ms, callback) {
        const timer: FakeTimer = { at: now + ms, callback, cancelled: false };
        timers.push(timer);
        return {
          cancel: () => {
            timer.cancelled = true;
          },
        };
      },
      read() {
        readTimes.push(now);
        const scripted = queued.shift();
        if (hold) {
          return new Promise<WatchRead>((resolve) => {
            held.push(() => resolve(scripted ?? snapshot()));
          });
        }
        return Promise.resolve(scripted ?? snapshot());
      },
    },
  });
  void tracker.result.then((result) => {
    resolved = result;
  });

  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  const harness = {
    tracker,
    field,
    readTimes,
    queued,
    snapshot,
    flush,
    get now() {
      return now;
    },
    get resolved() {
      return resolved;
    },
    setText(value: string, caret: number | null = value.length) {
      field.text = value;
      field.selection = caret === null ? null : { location: caret, length: 0 };
    },
    setHold(value: boolean) {
      hold = value;
    },
    async release() {
      const pending = held;
      held = [];
      for (const answer of pending) {
        answer();
      }
      await flush();
    },
    async key(keyCode: number, mods: Partial<KeyDown> = {}) {
      tracker.onKeyDown(key(keyCode, mods));
      await flush();
    },
    /** Presses `count` letter keys (editing keys). */
    async typeKeys(count: number) {
      for (let i = 0; i < count; i++) {
        tracker.onKeyDown(key(MAC_KEYCODES.A));
      }
      await flush();
    },
    /** Runs due timers in time order up to now + ms. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) {
          break;
        }
        now = Math.max(now, due.at);
        due.cancelled = true;
        due.callback();
        await flush();
      }
      now = target;
    },
    async advanceTo(time: number) {
      await harness.advance(time - now);
    },
  };
  return harness;
}

const PASTED = "open cloud code and run it";
const FIXED = "open Claude Code and run it";

async function locatedChat(pasted = PASTED) {
  const h = createHarness({ pasted });
  await h.advance(250);
  return h;
}

/** Types a fix: the keys land, the field shows `text`, the key read trusts it. */
async function typeFix(h: ReturnType<typeof createHarness>, text: string) {
  h.setText(text);
  await h.typeKeys(3);
  await h.advance(50);
}

describe("edit tracker scenarios", () => {
  it("1 editor: fixes the word and keeps working → window_elapsed, learns", async () => {
    const before = "Note: ";
    const after = " today";
    const h = createHarness({
      pasted: PASTED,
      text: before + PASTED + after,
      caret: before.length + PASTED.length,
    });
    await h.advanceTo(3300);
    h.setText(before + FIXED + after, before.length + FIXED.length);
    await h.typeKeys(3);
    await h.advance(50);
    await h.advanceTo(60_000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("window_elapsed");
    expect(result.finalRegion).toBe(FIXED);
    expect(result.changed).toBe(true);
    expect(result.staleFinalState).toBe(false);
    expect(result.keyEventsSeen).toBe(true);
    expect(result.located).toBe(true);
    expect(result.locateMs).toBe(250);
    expect(result.durationMs).toBe(60_000);
  });

  it("2 editor: next dictation with the shortcut → superseded after a final read; the Space key-down is ignored", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    await h.advanceTo(5300);
    const readsBefore = h.readTimes.length;

    // Real event order: the bridge emits the key-down, the shortcut manager
    // starts the session synchronously inside that emit.
    h.tracker.onKeyDown(key(MAC_KEYCODES.SPACE));
    h.tracker.onSessionStart();
    await h.flush();

    const result = await h.tracker.result;
    expect(result.endReason).toBe("superseded");
    expect(h.readTimes.length).toBe(readsBefore + 1);
    expect(result.finalRegion).toBe(FIXED);
    expect(result.staleFinalState).toBe(false);
  });

  it("3 chat with an empty box: fixes a word, presses Enter → sent, learns", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    await h.advanceTo(4300);
    await h.key(MAC_KEYCODES.ENTER);
    h.setText("");
    await h.advance(50);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("sent");
    expect(result.finalRegion).toBe(FIXED);
  });

  it("4 chat: types the last letter and presses Enter within 50 ms → sent, nothing (stale)", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, "open Claude Cod");
    await h.advanceTo(4300);
    h.setText("open Claude Code");
    await h.key(MAC_KEYCODES.E);
    await h.advance(10);
    await h.key(MAC_KEYCODES.ENTER);
    h.setText("");
    await h.advance(40);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("sent");
    expect(result.staleFinalState).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.finalRegion).toBeNull();
  });

  it("5 chat: fixes, presses Enter, types the next message before any read → sent, learns the fix", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    await h.advanceTo(4300);
    await h.key(MAC_KEYCODES.ENTER);
    h.setText("");
    await h.advance(10);
    h.setText("Hel");
    await h.typeKeys(3);
    await h.advance(40);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("sent");
    expect(result.finalRegion).toBe(FIXED);
    expect(result.staleFinalState).toBe(false);
  });

  it("6 chat: the read after Enter still shows the old text; the app clears later → sent, learns the fix", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    await h.advanceTo(4300);
    await h.key(MAC_KEYCODES.ENTER);
    await h.advance(50); // unchanged read keeps the mark
    await h.advanceTo(4600);
    h.setText("");
    await h.advanceTo(4700);
    h.setText("Next");
    await h.typeKeys(4);
    await h.advance(50);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("sent");
    expect(result.finalRegion).toBe(FIXED);
  });

  it("7 web editor that puts its placeholder into the value: fixes, clicks Send → field_cleared, learns", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    await h.advanceTo(4500);
    h.setText("Type a message…");
    await h.advanceTo(5000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("field_cleared");
    expect(result.finalRegion).toBe(FIXED);
  });

  it("8 selects the pasted text, presses Backspace, retypes → window_elapsed, learns the retyped term", async () => {
    const h = await locatedChat("ping the cube flow team");
    await h.advanceTo(3300);
    await h.key(MAC_KEYCODES.A, { metaKey: true });
    h.setText("");
    await h.key(MAC_KEYCODES.DELETE);
    await h.advance(50);
    expect(h.resolved).toBeNull();
    await h.advanceTo(3600);
    await typeFix(h, "ping");
    await h.advanceTo(4300);
    await typeFix(h, "ping the Kubeflow team");
    await h.advanceTo(60_000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("window_elapsed");
    expect(result.finalRegion).toBe("ping the Kubeflow team");
    expect(
      extractCandidates("ping the cube flow team", result.finalRegion ?? ""),
    ).toMatchObject({
      candidates: [{ term: "Kubeflow", heard: "cube flow" }],
    });
  });

  it("9 dictates Okay, presses Cmd+Z → paste_undone, nothing", async () => {
    const h = await locatedChat("Okay");
    await h.advanceTo(1500);
    h.setText("");
    await h.key(MAC_KEYCODES.Z, { metaKey: true });
    await h.advance(50);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("paste_undone");
    expect(result.finalRegion).toBeNull();
    expect(result.changed).toBe(false);
  });

  it("10 replaces the dictation with a different sentence → the region is learned, the rewrite guard rejects it", async () => {
    const pasted = "send the deck to john and the report to mike tomorrow";
    const rewritten = "please call Priya about budget review on Friday";
    const h = await locatedChat(pasted);
    await h.advanceTo(3300);
    await h.key(MAC_KEYCODES.A, { metaKey: true });
    await typeFix(h, rewritten);
    await h.advanceTo(60_000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("window_elapsed");
    expect(result.finalRegion).toBe(rewritten);
    const extraction = extractCandidates(pasted, result.finalRegion ?? "");
    expect(extraction.rewrite).toBe(true);
    expect(extraction.candidates).toEqual([]);
  });

  it("11 deletes the filler and fixes the term → learns Claude Code; the guard passes", async () => {
    const pasted = "um so like cloud code is great";
    const h = await locatedChat(pasted);
    await h.advanceTo(3300);
    await typeFix(h, "Claude Code is great");
    await h.advanceTo(60_000);

    const result = await h.tracker.result;
    expect(result.finalRegion).toBe("Claude Code is great");
    expect(extractCandidates(pasted, result.finalRegion ?? "")).toMatchObject({
      rewrite: false,
      candidates: [{ term: "Claude Code", heard: "um so like cloud code" }],
    });
  });

  it("12 macOS spelling menu (no key stream): fix, wait, click Send → field_cleared, learns when the last two trusted reads agree", async () => {
    const h = await locatedChat("ping the cube flow team");
    await h.advanceTo(2500);
    h.setText("ping the Kubeflow team");
    await h.advanceTo(4500); // reads at 3000 and 4000 both see the fix
    h.setText("");
    await h.advanceTo(5000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("field_cleared");
    expect(result.keyEventsSeen).toBe(false);
    expect(result.stableFinalState).toBe(true);
    expect(result.finalRegion).toBe("ping the Kubeflow team");
  });

  it("13 Windows without a key stream: fix and Enter within 1 s → field_cleared, nothing (no stable state)", async () => {
    const h = createHarness({
      pasted: "ping the cube flow team",
      platform: "win32",
    });
    await h.advanceTo(1200);
    h.setText("ping the Kubeflow team");
    await h.advanceTo(2100); // one read (2000) saw the fix
    h.setText("");
    await h.advanceTo(3000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("field_cleared");
    expect(result.keyEventsSeen).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.stableFinalState).toBe(false);
    expect(result.finalRegion).toBeNull();
  });

  it("14 the app converts quotes in the pasted text → pasted_text_not_found", async () => {
    const h = createHarness({
      pasted: 'say "hi" now',
      text: "say “hi” now",
      caret: null,
    });
    await h.advanceTo(2000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("pasted_text_not_found");
    expect(result.located).toBe(false);
    expect(result.locateMs).toBeNull();
    expect(result.finalRegion).toBeNull();
    expect(result.durationMs).toBe(2000);
  });

  it("16 clicks Send, then starts the next message within 1 s → the next message is sent as the region (residual risk 2)", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    await h.advanceTo(3500);
    h.setText(""); // click Send; no read before the next message
    await h.advanceTo(3900);
    await typeFix(h, "Hello");
    await h.advanceTo(4300);
    await h.key(MAC_KEYCODES.ENTER);
    h.setText("");
    await h.advance(50);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("sent");
    expect(result.finalRegion).toBe("Hello");
  });

  it("17 the target app hangs → read_failed on the first timeout, learns from the last trusted region", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    h.queued.push({ status: "timeout" });
    await h.advanceTo(4000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("read_failed");
    expect(result.readErrorCount).toBe(1);
    expect(result.finalRegion).toBe(FIXED);
  });

  it("18 drags the second sentence to the front before any key, fixes a word, Enter → sent, learns", async () => {
    const first =
      "ping the cube flow team about the pipeline and the memory issues we saw last week.";
    const second = "the deploy to staging is done and the alerts are quiet.";
    const h = await locatedChat(`${first} ${second}`);
    await h.advanceTo(4300);
    h.setText(`${second} ${first}`); // drag-drop: no key, the same words
    await h.advanceTo(6300);
    const fixed = `${second} ${first.replace("cube flow", "Kubeflow")}`;
    await typeFix(h, fixed);
    await h.advanceTo(8300);
    await h.key(MAC_KEYCODES.ENTER);
    h.setText("");
    await h.advance(50);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("sent");
    expect(result.finalRegion).toBe(fixed);
    expect(result.rearrangedCount).toBe(1);
  });

  it("19 fixes a word, cuts the first sentence with the mouse, fixes another word, clicks Send → field_cleared, learns the second fix", async () => {
    const pasted =
      "tell cloud code to rerun the nightly job when the deploy to staging is done. also ping the cube flow team about the pipeline today.";
    const h = await locatedChat(pasted);
    await h.advanceTo(2300);
    await typeFix(h, pasted.replace("cloud code", "Claude Code"));
    await h.advanceTo(4300);
    h.setText("also ping the cube flow team about the pipeline today."); // context-menu Cut: no key
    await h.advanceTo(6300);
    await typeFix(h, "also ping the Kubeflow team about the pipeline today.");
    await h.advanceTo(8300);
    h.setText(""); // click Send
    await h.advanceTo(9000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("field_cleared");
    expect(result.finalRegion).toBe(
      "also ping the Kubeflow team about the pipeline today.",
    );
    expect(result.rearrangedCount).toBe(1);
    expect(extractCandidates(pasted, result.finalRegion ?? "")).toMatchObject({
      candidates: [{ term: "Kubeflow", heard: "cube flow" }],
    });
  });

  it("20 no key stream: fix, then the next message starts with a word of the region → field_cleared, learns the fix", async () => {
    const h = await locatedChat("ping the cube flow team");
    await h.advanceTo(2500);
    h.setText("ping the Kubeflow team");
    await h.advanceTo(4500); // reads at 3000 and 4000 both see the fix
    h.setText("the", 3); // cleared and retyped inside the same second
    await h.advanceTo(5000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("field_cleared");
    expect(result.keyEventsSeen).toBe(false);
    expect(result.finalRegion).toBe("ping the Kubeflow team");
  });

  it("21 fixes a name, clicks Send; the placeholder repeats the region's words in another case → field_cleared, learns the fix", async () => {
    const h = await locatedChat("message Pria about the deck");
    await h.advanceTo(2300);
    await typeFix(h, "message Priya about the deck");
    await h.advanceTo(4300);
    h.setText("Message Priya", 0); // the placeholder leaks into the value
    await h.advanceTo(5000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("field_cleared");
    expect(result.finalRegion).toBe("message Priya about the deck");
  });

  it("22 starts a typed rewrite, then clicks Undo twice (no keys): the paste is back, then the field is empty → field_cleared, nothing", async () => {
    const h = await locatedChat("ping the cube flow team");
    await h.advanceTo(4300);
    await h.key(MAC_KEYCODES.A, { metaKey: true });
    await typeFix(h, "Actually");
    await h.advanceTo(9300);
    h.setText("ping the cube flow team"); // toolbar Undo restores the paste
    await h.advanceTo(11300);
    h.setText("", 0); // toolbar Undo removes the paste
    await h.advanceTo(12000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("field_cleared");
    expect(result.changed).toBe(false);
    expect(result.finalRegion).toBeNull();
    expect(result.pasteResetCount).toBe(1);
  });
});

describe("edit tracker read status mapping", () => {
  it.each([
    ["gone", "element_gone"],
    ["unknown_watch", "helper_restart"],
    ["too_long", "too_long"],
  ] as const)("%s → %s", async (status, endReason) => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    h.queued.push({ status, text: null, selection: null, readMs: 3 });
    await h.advanceTo(4000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe(endReason);
    expect(result.finalRegion).toBe(FIXED);
    expect(result.readErrorCount).toBe(0);
  });

  it("three error answers in a row → read_failed; a good read resets the count", async () => {
    const error: WatchRead = {
      status: "error",
      text: null,
      selection: null,
      readMs: 9,
    };
    const h = createHarness({ pasted: PASTED });
    h.queued.push(error);
    await h.advanceTo(1000); // 250 fails, 1000 locates
    expect(h.resolved).toBeNull();
    h.queued.push(error, error);
    await h.advanceTo(4000); // 2000 and 3000 fail, 4000 resets
    expect(h.resolved).toBeNull();
    h.queued.push(error, error, error);
    await h.advanceTo(6000);
    expect(h.resolved).toBeNull();
    await h.advanceTo(7000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("read_failed");
    expect(result.readErrorCount).toBe(6);
    expect(result.readCount).toBe(8);
    expect(result.located).toBe(true);
    expect(result.finalRegion).toBeNull();
    expect(result.readMsMax).toBe(9);
  });

  it("an RPC timeout ends the watch at once, even as the first read", async () => {
    const h = createHarness({ pasted: PASTED });
    h.queued.push({ status: "timeout" });
    await h.advance(250);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("read_failed");
    expect(result.readErrorCount).toBe(1);
    expect(result.located).toBe(false);
  });
});

describe("edit tracker end triggers", () => {
  it("another paste ends with superseded at once, without a read", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    const readsBefore = h.readTimes.length;
    h.tracker.onOtherPaste();

    const result = await h.tracker.result;
    expect(result.endReason).toBe("superseded");
    expect(h.readTimes.length).toBe(readsBefore);
    expect(result.finalRegion).toBe(FIXED);
  });

  it("a helper restart ends with helper_restart", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    h.tracker.onHelperRestart();

    const result = await h.tracker.result;
    expect(result.endReason).toBe("helper_restart");
    expect(result.finalRegion).toBe(FIXED);
  });

  it("waits for an in-flight read and lets that read decide", async () => {
    const h = await locatedChat();
    await h.advanceTo(2300);
    await typeFix(h, FIXED);
    await h.advanceTo(2500);
    await h.key(MAC_KEYCODES.ENTER);
    await h.advance(50); // unchanged read keeps the mark
    h.setHold(true);
    await h.advanceTo(3000); // periodic read in flight
    h.setText("");
    h.tracker.onOtherPaste();
    await h.flush();
    expect(h.resolved).toBeNull();
    await h.release();

    const result = await h.tracker.result;
    expect(result.endReason).toBe("sent");
    expect(result.finalRegion).toBe(FIXED);
  });

  it("ignores key-downs after an end trigger while the final read is in flight", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    h.setHold(true);
    h.tracker.onSessionStart();
    await h.flush();
    await h.key(MAC_KEYCODES.B);
    await h.release();

    const result = await h.tracker.result;
    expect(result.endReason).toBe("superseded");
    expect(result.keyEventsSeen).toBe(true);
    expect(result.staleFinalState).toBe(false);
    expect(result.finalRegion).toBe(FIXED);
  });

  it("ends with anchors_broken when the text around the paste changes", async () => {
    const before = "Note: ";
    const h = createHarness({
      pasted: PASTED,
      text: before + PASTED,
      caret: before.length + PASTED.length,
    });
    await h.advanceTo(3300);
    await typeFix(h, "Memo: " + FIXED);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("anchors_broken");
    expect(result.finalRegion).toBeNull();
    expect(result.changed).toBe(false);
  });

  it("re-anchors when an edit before the paste breaks the anchors but the region is intact; learns a later fix", async () => {
    const before = "hey, about the ";
    const pasted = "cube flow migration, pria says it is on track";
    const h = createHarness({
      pasted,
      text: before + pasted,
      caret: before.length + pasted.length,
    });
    await h.advanceTo(3300);
    await typeFix(h, "Hi, about the " + pasted);
    expect(h.resolved).toBeNull();
    await h.advanceTo(6300);
    await typeFix(
      h,
      "Hi, about the Kubeflow migration, Priya says it is on track",
    );
    await h.advanceTo(60_000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("window_elapsed");
    expect(result.finalRegion).toBe(
      "Kubeflow migration, Priya says it is on track",
    );
    expect(result.reanchorCount).toBe(1);
  });

  it("does not re-anchor onto a copy of the region in the old anchor text once the paste is deleted", async () => {
    const h = createHarness({
      pasted: "ok",
      text: "Is this ok? Yes: ok",
      caret: 19,
    });
    await h.advanceTo(3300);
    h.setText("Is this ok? Yes"); // selects ": ok" and deletes it
    await h.typeKeys(1);
    await h.advance(50);

    expect(h.resolved).not.toBeNull();
    const result = await h.tracker.result;
    expect(result.endReason).toBe("anchors_broken");
    expect(result.changed).toBe(false);
    expect(result.finalRegion).toBeNull();
  });

  it("a newline Enter in an editor clears the mark; learns from the region", async () => {
    const h = await locatedChat();
    await h.advanceTo(3300);
    await typeFix(h, FIXED);
    await h.advanceTo(3500);
    await h.key(MAC_KEYCODES.ENTER);
    h.setText(FIXED + "\nmore");
    await h.advance(50);
    await h.typeKeys(4);
    await h.advanceTo(60_000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("window_elapsed");
    expect(result.finalRegion).toBe(FIXED + "\nmore");
    expect(result.enterMarkDroppedCount).toBe(1);
  });
});

describe("edit tracker read schedule", () => {
  it("first read at +250 ms, every 1 s, +50 ms after a key, at least 100 ms apart", async () => {
    const h = await locatedChat();
    await h.advanceTo(1500);
    await h.key(MAC_KEYCODES.A);
    await h.advanceTo(1560);
    await h.key(MAC_KEYCODES.B);
    await h.advanceTo(1570);
    await h.key(MAC_KEYCODES.C);
    await h.advanceTo(2000);

    expect(h.readTimes).toEqual([250, 1000, 1550, 1650, 2000]);
  });

  it("at most one read in flight; a request during a read runs after it", async () => {
    const h = await locatedChat();
    h.setHold(true);
    await h.advanceTo(1000);
    await h.advanceTo(1020);
    await h.key(MAC_KEYCODES.A);
    await h.advanceTo(1100);
    expect(h.readTimes).toEqual([250, 1000]);
    h.setHold(false);
    await h.release();
    expect(h.readTimes).toEqual([250, 1000, 1100]);
  });
});

describe("edit tracker locate", () => {
  it("locates by the caret when the pasted text occurs more than once", async () => {
    const h = createHarness({
      pasted: "hello",
      text: "hello hello",
      caret: 11,
    });
    await h.advance(250);
    await h.advanceTo(3300);
    await typeFix(h, "hello Hallo");
    h.tracker.onOtherPaste();

    const result = await h.tracker.result;
    expect(result.located).toBe(true);
    expect(result.finalRegion).toBe("Hallo");
  });

  it("locates by a unique match when there is no selection", async () => {
    const before = "Dear team, ";
    const after = ". Thanks";
    const h = createHarness({
      pasted: "ping the cube flow team",
      text: before + "ping the cube flow team" + after,
      caret: null,
    });
    await h.advance(250);
    await h.advanceTo(3300);
    h.setText(before + "ping the Kubeflow team" + after, null);
    await h.typeKeys(2);
    await h.advance(50);
    h.tracker.onOtherPaste();

    const result = await h.tracker.result;
    expect(result.locateMs).toBe(250);
    expect(result.finalRegion).toBe("ping the Kubeflow team");
  });

  it("does not locate an ambiguous match without a caret", async () => {
    const h = createHarness({
      pasted: "hello",
      text: "hello hello",
      caret: null,
    });
    await h.advanceTo(2000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("pasted_text_not_found");
  });

  it("keeps locating on the first read that shows the paste, after an early empty read", async () => {
    const h = createHarness({ pasted: PASTED, text: "", caret: 0 });
    await h.advance(250);
    h.setText(PASTED);
    await h.advanceTo(1000);
    h.tracker.onOtherPaste();

    const result = await h.tracker.result;
    expect(result.located).toBe(true);
    expect(result.locateMs).toBe(1000);
  });

  it("normalizes the pasted text like the Windows helper before locating", async () => {
    const h = createHarness({
      pasted: "line one\r\nline two\uFEFF",
      platform: "win32",
      text: "line one\nline two",
    });
    await h.advance(250);
    await h.advanceTo(3300);
    h.setText("line one\nline 2", null);
    await h.key(WINDOWS_KEYCODES.TWO);
    await h.advance(50);
    h.tracker.onOtherPaste();

    const result = await h.tracker.result;
    expect(result.located).toBe(true);
    expect(result.finalRegion).toBe("line one\nline 2");
  });

  it("does not normalize the pasted text on macOS", async () => {
    const h = createHarness({
      pasted: "a\r\nb",
      platform: "darwin",
      text: "a\nb",
      caret: null,
    });
    await h.advanceTo(2000);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("pasted_text_not_found");
  });
});

describe("key classification", () => {
  const mac = "darwin";
  const win = "win32";

  it("recognizes every Enter code", () => {
    expect(isEnterKey(key(MAC_KEYCODES.ENTER), mac)).toBe(true);
    expect(isEnterKey(key(MAC_KEYCODES.ENTER_LEGACY), mac)).toBe(true);
    expect(isEnterKey(key(MAC_KEYCODES.KEYPAD_ENTER), mac)).toBe(true);
    expect(isEnterKey(key(WINDOWS_KEYCODES.ENTER), win)).toBe(true);
    expect(isEnterKey(key(MAC_KEYCODES.A), mac)).toBe(false);
  });

  it.each([
    ["Enter", key(MAC_KEYCODES.ENTER), mac, false],
    ["Cmd+Enter", key(MAC_KEYCODES.ENTER, { metaKey: true }), mac, false],
    ["Left arrow", key(MAC_KEYCODES.LEFT), mac, false],
    ["Home", key(MAC_KEYCODES.HOME), mac, false],
    ["Page Down", key(MAC_KEYCODES.PAGE_DOWN), mac, false],
    ["F5", key(MAC_KEYCODES.F5), mac, false],
    ["Shift alone", key(MAC_KEYCODES.SHIFT), mac, false],
    ["Fn alone", key(MAC_KEYCODES.FN), mac, false],
    ["Cmd+A", key(MAC_KEYCODES.A, { metaKey: true }), mac, false],
    ["Cmd+S", key(MAC_KEYCODES.S, { metaKey: true }), mac, false],
    ["Ctrl+K", key(MAC_KEYCODES.K, { ctrlKey: true }), mac, false],
    ["Cmd+Z", key(MAC_KEYCODES.Z, { metaKey: true }), mac, true],
    ["Cmd+X", key(MAC_KEYCODES.X, { metaKey: true }), mac, true],
    ["Cmd+V", key(MAC_KEYCODES.V, { metaKey: true }), mac, true],
    ["Cmd+Y", key(MAC_KEYCODES.Y, { metaKey: true }), mac, true],
    ["Cmd+Backspace", key(MAC_KEYCODES.DELETE, { metaKey: true }), mac, true],
    [
      "Cmd+Forward Delete",
      key(MAC_KEYCODES.FORWARD_DELETE, { metaKey: true }),
      mac,
      true,
    ],
    ["Letter", key(MAC_KEYCODES.E), mac, true],
    ["Tab", key(MAC_KEYCODES.TAB), mac, true],
    ["Escape", key(MAC_KEYCODES.ESCAPE), mac, true],
    ["Space", key(MAC_KEYCODES.SPACE), mac, true],
    ["Backspace", key(MAC_KEYCODES.DELETE), mac, true],
    ["Windows Enter", key(WINDOWS_KEYCODES.ENTER), win, false],
    ["Windows Up arrow", key(WINDOWS_KEYCODES.UP), win, false],
    ["Windows End", key(WINDOWS_KEYCODES.END), win, false],
    ["Windows F11", key(WINDOWS_KEYCODES.F11), win, false],
    ["Windows Ctrl alone", key(WINDOWS_KEYCODES.CTRL), win, false],
    ["Windows Win alone", key(WINDOWS_KEYCODES.RWIN), win, false],
    ["Windows Ctrl+S", key(WINDOWS_KEYCODES.S, { ctrlKey: true }), win, false],
    ["Windows Win+K", key(WINDOWS_KEYCODES.K, { metaKey: true }), win, false],
    ["Windows Ctrl+Z", key(WINDOWS_KEYCODES.Z, { ctrlKey: true }), win, true],
    ["Windows Ctrl+V", key(WINDOWS_KEYCODES.V, { ctrlKey: true }), win, true],
    [
      "Windows Ctrl+Backspace",
      key(WINDOWS_KEYCODES.BACKSPACE, { ctrlKey: true }),
      win,
      true,
    ],
    [
      "Windows Ctrl+Delete",
      key(WINDOWS_KEYCODES.DELETE, { ctrlKey: true }),
      win,
      true,
    ],
    ["Windows Tab", key(WINDOWS_KEYCODES.TAB), win, true],
    ["Windows Escape", key(WINDOWS_KEYCODES.ESCAPE), win, true],
    ["Windows letter", key(WINDOWS_KEYCODES.Q), win, true],
  ] as const)("%s", (_name, keyDown, platform, editing) => {
    expect(isEditingKey(keyDown, platform)).toBe(editing);
  });

  it("Ctrl+Z on Windows counts as the undo for paste_undone", async () => {
    const h = createHarness({ pasted: "Okay", platform: "win32" });
    await h.advance(250);
    await h.advanceTo(1500);
    h.setText("");
    await h.key(WINDOWS_KEYCODES.Z, { ctrlKey: true });
    await h.advance(50);

    const result = await h.tracker.result;
    expect(result.endReason).toBe("paste_undone");
  });
});
