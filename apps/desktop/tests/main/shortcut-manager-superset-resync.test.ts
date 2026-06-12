import { describe, expect, it } from "vitest";
import {
  createManager,
  flush,
  usePttShortcut,
  useToggleShortcut,
} from "./shortcut-manager-test-utils";

// Abstract keycodes. PHANTOM stands in for a key whose key-up was missed and is
// therefore stuck in the held state.
const A = 101;
const B = 102;
const PHANTOM = 103;
const EXTRA = 104;

// Build a manager whose resync RPC samples OS truth on entry but holds its
// response until `release()` is called — lets a test drive events while a
// recheck is deliberately in flight. `physicallyDown` is sampled when each
// call ENTERS (not when it resolves): mutating it mid-flight does not change
// what the in-flight RPC reports, only what a later call (e.g. the follow-up
// recheck) sees.
const createGated = (physicallyDown: Set<number>) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ctx = createManager({
    recheck: async ({ pressedKeyCodes }) => {
      const staleKeyCodes = pressedKeyCodes.filter(
        (code) => !physicallyDown.has(code),
      );
      await gate;
      return { staleKeyCodes };
    },
  });
  return { ...ctx, release };
};

describe("ShortcutManager superset resync (prune stuck keys)", () => {
  it("resyncs when held keys are a superset of a shortcut and the exact match then fires", async () => {
    // A and B are really down; PHANTOM is stuck from a missed key-up.
    const { internals, timeline, recheckPressedKeys } = createManager({
      physicallyDown: new Set([A, B]),
    });
    useToggleShortcut(internals);

    internals.addActiveKey(PHANTOM); // {P}
    internals.addActiveKey(A); // {P,A}
    internals.addActiveKey(B); // {P,A,B} — superset of [A,B]; exact match blocked
    expect(timeline).toEqual([]);

    await flush();

    expect(recheckPressedKeys).toHaveBeenCalled();
    // The stuck key is pruned, leaving exactly the shortcut...
    expect(internals.getActiveKeys()).toEqual([A, B]);
    // ...which lets the previously-blocked exact match fire.
    expect(timeline).toEqual(["toggle"]);
  });

  it("does not prune genuinely-held keys", async () => {
    // Every held key is really down: a legitimate superset, nothing to prune.
    const { internals, timeline, recheckPressedKeys } = createManager({
      physicallyDown: new Set([A, B, PHANTOM]),
    });
    useToggleShortcut(internals);

    internals.addActiveKey(A);
    internals.addActiveKey(B); // exact → toggle fires now
    internals.addActiveKey(PHANTOM); // {A,B,P} — superset triggers a resync

    await flush();

    expect(recheckPressedKeys).toHaveBeenCalled();
    expect(internals.getActiveKeys()).toEqual([A, B, PHANTOM]);
    expect(timeline).toEqual(["toggle"]);
  });

  it("does not resync on a plain exact match with no extra keys", async () => {
    const { internals, recheckPressedKeys } = createManager({
      physicallyDown: new Set([A, B]),
    });
    useToggleShortcut(internals);

    internals.addActiveKey(A);
    internals.addActiveKey(B); // exact match, not a superset of anything

    await flush();

    expect(recheckPressedKeys).not.toHaveBeenCalled();
  });

  it("coalesces resyncs while one is in flight instead of stacking RPCs", async () => {
    // Resync firing is deliberately stateless (every key-down in a superset
    // state fires); the single-flight guard is what bounds the RPC rate.
    const { internals, recheckPressedKeys } = createManager({
      physicallyDown: new Set([A, B, PHANTOM, EXTRA]),
    });
    useToggleShortcut(internals);

    internals.addActiveKey(A);
    internals.addActiveKey(B);
    internals.addActiveKey(PHANTOM); // superset → resync fires (in flight)
    internals.addActiveKey(EXTRA); // still superset → queued behind the flight

    await flush();

    // One in-flight RPC + one coalesced follow-up — not one per key-down.
    expect(recheckPressedKeys).toHaveBeenCalledTimes(2);
  });

  it("resyncs when a later key-down completes a different shortcut inside an existing superset", async () => {
    // PTT [A,B] is already strictly contained (extra PHANTOM held). PHANTOM's
    // key-up is then missed, and the user presses EXTRA, completing toggle
    // [A,B,EXTRA] — newly blocked by the now-stale key. Stateless firing
    // guarantees this key-down gets its own resync (edge-tracking used to
    // suppress it because "a superset" was already true).
    const physicallyDown = new Set([A, B, PHANTOM]);
    const { internals, timeline, recheckPressedKeys } = createManager({
      physicallyDown,
    });
    internals.shortcuts = {
      pushToTalk: [A, B],
      toggleRecording: [A, B, EXTRA],
      pasteLastTranscript: [],
      newNote: [],
    };

    internals.addActiveKey(A);
    internals.addActiveKey(B); // exact PTT → press
    internals.addActiveKey(PHANTOM); // {A,B,P} — superset of PTT → resync; P genuinely down
    await flush();
    expect(timeline).toEqual(["press"]);
    expect(recheckPressedKeys).toHaveBeenCalledTimes(1);

    // P is released but its key-up is missed; the user then completes toggle.
    physicallyDown.delete(PHANTOM);
    physicallyDown.add(EXTRA);
    internals.addActiveKey(EXTRA); // {A,B,P,EXTRA} — toggle blocked by stale P

    await flush();

    expect(recheckPressedKeys).toHaveBeenCalledTimes(2); // a fresh resync fired
    expect(internals.getActiveKeys()).toEqual([A, B, EXTRA]); // stale P pruned
    expect(timeline).toEqual(["press", "toggle"]); // the freed toggle fired
  });
});

describe("ShortcutManager PTT self-recovery after a prune", () => {
  it("starts PTT when a key-down resync prunes a stuck key down to the exact PTT set", async () => {
    // Only A is physically down; PHANTOM is stuck and masks the exact PTT match.
    const { internals, timeline, recheckPressedKeys } = createManager({
      physicallyDown: new Set([A]),
    });
    usePttShortcut(internals);

    internals.addActiveKey(PHANTOM); // {P} — stuck phantom
    internals.addActiveKey(A); // {P,A} — superset of [A]; exact PTT masked
    expect(timeline).toEqual([]); // PTT blocked by the phantom

    await flush();

    expect(recheckPressedKeys).toHaveBeenCalled();
    expect(internals.getActiveKeys()).toEqual([A]);
    // The press the user intended now fires — the prune is driven by the A
    // key-down, so it activates PTT exactly as if no phantom had been present.
    expect(timeline).toEqual(["press"]);
  });

  it("does NOT start PTT when the periodic sweep prunes down to the PTT set", async () => {
    // Guards the anti-phantom invariant: a prune with no triggering key-down
    // (the 10s sweep) must not latch PTT, or it would emit a phantom press and
    // stop a hands-free session that merely keeps the PTT key held.
    const physicallyDown = new Set([A, PHANTOM]); // both initially "down"
    const { manager, internals, timeline } = createManager({ physicallyDown });
    usePttShortcut(internals);

    internals.addActiveKey(PHANTOM); // {P}
    internals.addActiveKey(A); // {P,A} — key-down resync fires, but P is "down"
    await flush();
    expect(internals.getActiveKeys()).toEqual([PHANTOM, A]); // nothing pruned yet
    expect(timeline).toEqual([]);

    // P is now physically released but its key-up was missed; the periodic
    // sweep finds it stale.
    physicallyDown.delete(PHANTOM);
    await manager.maybeRecheckPressedKeys(); // periodic path — no triggering key-down

    expect(internals.getActiveKeys()).toEqual([A]); // P pruned
    expect(timeline).toEqual([]); // PTT must NOT latch from a passive prune
  });

  it("does NOT latch PTT when the triggering key itself was pruned (its key-up was missed mid-flight)", async () => {
    // PTT = [B]. PHANTOM is genuinely held at first, masking PTT while B goes down.
    const physicallyDown = new Set([PHANTOM, B]);
    const { internals, timeline } = createManager({ physicallyDown });
    usePttShortcut(internals, [B]);

    internals.addActiveKey(PHANTOM); // {P}
    internals.addActiveKey(B); // {P,B} — superset; resync finds nothing stale
    await flush();
    expect(timeline).toEqual([]); // PTT masked by P

    // P released normally: collapsing to the PTT set on a key-up must not latch.
    physicallyDown.delete(PHANTOM);
    internals.removeActiveKey(PHANTOM); // {B}
    expect(timeline).toEqual([]);

    // The user taps A so fast that its key-up is missed and the OS sample
    // already sees it up. A's key-down makes {B,A} a superset → a resync fires
    // with A as its trigger → A itself is pruned. The remaining {B} is exactly
    // the PTT set, but the user reached it by RELEASE, not by a surviving
    // key-down — it must NOT latch.
    internals.addActiveKey(A); // A never enters physicallyDown
    await flush();

    expect(internals.getActiveKeys()).toEqual([B]);
    expect(timeline).toEqual([]);
  });

  it("keeps PTT latched when a prune reports the latched key stale", async () => {
    // Deliberate trade-off: a single OS sample cannot distinguish "released
    // but the key-up was missed" (where pruning would rescue a stuck
    // recording) from "held but the OS key table was poisoned by injected
    // events" (PowerToys-class remappers, our own masking SendInput — where
    // pruning would truncate a LIVE recording mid-sentence). The latched
    // chord is exempt from pruning; a genuinely stuck recording stops via
    // the next delivered key event, the UI, or the max-duration auto-stop.
    const physicallyDown = new Set([A]);
    const { manager, internals, timeline } = createManager({ physicallyDown });
    usePttShortcut(internals);

    internals.addActiveKey(A); // exact → press
    expect(timeline).toEqual(["press"]);

    physicallyDown.delete(A); // table says A is up; the user may still hold it
    await manager.maybeRecheckPressedKeys();

    expect(internals.getActiveKeys()).toEqual([A]);
    expect(timeline).toEqual(["press"]);
  });
});

describe("ShortcutManager resync requests during an in-flight recheck", () => {
  it("a key-down arriving while a passive recheck is in flight still latches PTT", async () => {
    // The 10s sweep's RPC is in flight when the user presses the PTT key. The
    // key-down's resync request must not be silently dropped: a follow-up
    // recheck validates it against fresh OS truth and then honors it.
    const physicallyDown = new Set<number>();
    const { manager, internals, timeline, recheckPressedKeys, release } =
      createGated(physicallyDown);
    usePttShortcut(internals);

    internals.addActiveKey(PHANTOM); // {P} — stuck (not physically down)
    const sweep = manager.maybeRecheckPressedKeys(); // periodic sweep, held in flight
    physicallyDown.add(A);
    internals.addActiveKey(A); // {P,A} — superset → key-down resync requested
    release();
    await sweep;
    await flush();

    expect(internals.getActiveKeys()).toEqual([A]); // P pruned by the sweep
    expect(timeline).toEqual(["press"]); // the user's key-down was honored
    expect(recheckPressedKeys).toHaveBeenCalledTimes(2); // by the follow-up recheck
  });

  it("does NOT latch PTT for a key tapped mid-flight whose key-up was missed", async () => {
    // The sweep is in flight when the user TAPS the PTT key — down, then a
    // missed key-up. The pending key-down was never in the in-flight snapshot,
    // so the OS never vouched for it: the follow-up recheck must validate it
    // (and finds it stale) instead of synthesizing a press for a released key.
    const physicallyDown = new Set<number>(); // P stuck; A's tap never seen down
    const { manager, internals, timeline, recheckPressedKeys, release } =
      createGated(physicallyDown);
    usePttShortcut(internals);

    internals.addActiveKey(PHANTOM); // {P} — stuck
    const sweep = manager.maybeRecheckPressedKeys(); // sweep in flight over [P]
    internals.addActiveKey(A); // the tap goes down: {P,A} — superset → resync queued
    // ...and its key-up is missed before any OS sample sees it.
    release();
    await sweep;
    await flush();

    expect(recheckPressedKeys).toHaveBeenCalledTimes(2); // follow-up validated the tap
    expect(internals.getActiveKeys()).toEqual([]); // phantom AND tapped key pruned
    expect(timeline).toEqual([]); // no phantom press for an already-released key
  });

  it("does NOT latch PTT when a delivered key-up collapses to the PTT set mid-flight", async () => {
    // A real extra key is released while a key-down resync is in flight,
    // collapsing the held set down to exactly the PTT set. The user reached
    // this state by RELEASE, so the resync completing with nothing stale must
    // not convert it into a press.
    const physicallyDown = new Set([A, EXTRA]);
    const { internals, timeline, release } = createGated(physicallyDown);
    usePttShortcut(internals);

    internals.addActiveKey(EXTRA); // {E}
    internals.addActiveKey(A); // {E,A} — superset → resync held in flight; PTT masked
    // Let the clock tick so the key-up below timestamps after A's key-down.
    await new Promise((resolve) => setTimeout(resolve, 2));
    physicallyDown.delete(EXTRA);
    internals.removeActiveKey(EXTRA); // delivered key-up → {A}: collapse, no latch
    expect(timeline).toEqual([]);
    release();
    await flush();

    expect(internals.getActiveKeys()).toEqual([A]);
    expect(timeline).toEqual([]); // the in-flight resync must not latch the collapse
  });

  it("does not turn a key-up collapse into a press when the trigger key auto-repeats", async () => {
    // Same collapse as above, but A auto-repeats after EXTRA's key-up,
    // refreshing A's KeyInfo timestamp. The repeat must not re-order A's
    // key-down after the release (the trigger's key-down time is captured
    // when the resync is requested).
    const physicallyDown = new Set([A, EXTRA]);
    const { internals, timeline, release } = createGated(physicallyDown);
    usePttShortcut(internals);

    internals.addActiveKey(EXTRA); // {E}
    internals.addActiveKey(A); // {E,A} — superset → resync(trigger A) held in flight
    await new Promise((resolve) => setTimeout(resolve, 2));
    physicallyDown.delete(EXTRA);
    internals.removeActiveKey(EXTRA); // delivered key-up → {A}: collapse, no latch
    expect(timeline).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 2));
    internals.addActiveKey(A); // auto-repeat: refreshes A's timestamp past the key-up
    release();
    await flush();

    expect(internals.getActiveKeys()).toEqual([A]);
    expect(timeline).toEqual([]);
  });

  it("re-runs the recheck when the in-flight OS sample predated the stale key", async () => {
    // The sweep sampled while PHANTOM was still physically down, so it prunes
    // nothing — but a key-down arrived mid-flight. A follow-up recheck must
    // run with a fresh sample so the user's press isn't lost.
    const physicallyDown = new Set([PHANTOM]); // P genuinely down at sample time
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstCall = true;
    const { manager, internals, timeline, recheckPressedKeys } = createManager({
      recheck: async ({ pressedKeyCodes }) => {
        const staleKeyCodes = pressedKeyCodes.filter(
          (code) => !physicallyDown.has(code),
        );
        if (firstCall) {
          firstCall = false;
          await gate;
        }
        return { staleKeyCodes };
      },
    });
    usePttShortcut(internals);

    internals.addActiveKey(PHANTOM); // {P}
    const sweep = manager.maybeRecheckPressedKeys(); // samples [P] → nothing stale
    // During the flight: P's release is missed and the user presses A.
    physicallyDown.delete(PHANTOM);
    physicallyDown.add(A);
    internals.addActiveKey(A); // {P,A} — superset → resync queued behind the flight
    release();
    await sweep;
    await flush();

    // The queued request re-ran with a fresh sample: P pruned, A's key-down honored.
    expect(recheckPressedKeys).toHaveBeenCalledTimes(2);
    expect(internals.getActiveKeys()).toEqual([A]);
    expect(timeline).toEqual(["press"]);
  });
});

describe("ShortcutManager pending-trigger overwrite (latest intent wins)", () => {
  // The pending slot keeps only the LATEST key-down trigger. These tests pin
  // why that is safe: the trigger is evidence of a recent press, not an
  // instruction to latch — a latch additionally requires the post-prune set
  // to be exactly the PTT chord with the trigger inside it. A stolen slot can
  // therefore only fail guards (degrading to key-up semantics, fail-safe),
  // never synthesize a press the rightful trigger wouldn't have.

  it("an overwriting trigger that is still held cannot latch — the set is not exact", async () => {
    const physicallyDown = new Set<number>(); // PHANTOM stuck
    const { manager, internals, timeline, recheckPressedKeys, release } =
      createGated(physicallyDown);
    usePttShortcut(internals); // PTT = [A]

    internals.addActiveKey(PHANTOM); // {P}
    const sweep = manager.maybeRecheckPressedKeys(); // held in flight over [P]
    physicallyDown.add(A);
    internals.addActiveKey(A); // pending = {A} — the PTT press
    physicallyDown.add(EXTRA);
    internals.addActiveKey(EXTRA); // pending = {EXTRA} — slot stolen
    release();
    await sweep;
    await flush();

    expect(recheckPressedKeys).toHaveBeenCalledTimes(2);
    expect(internals.getActiveKeys()).toEqual([A, EXTRA]); // P pruned
    // EXTRA survived its guards, but {A,EXTRA} is not exactly the PTT chord.
    expect(timeline).toEqual([]);
  });

  it("an overwriting trigger that dies loses the recovery but never phantoms; a re-press works", async () => {
    const physicallyDown = new Set<number>(); // PHANTOM stuck
    const { manager, internals, timeline, recheckPressedKeys, release } =
      createGated(physicallyDown);
    usePttShortcut(internals); // PTT = [A]

    internals.addActiveKey(PHANTOM); // {P}
    const sweep = manager.maybeRecheckPressedKeys(); // held in flight over [P]
    physicallyDown.add(A);
    internals.addActiveKey(A); // pending = {A} — the press that deserved the latch
    internals.addActiveKey(EXTRA); // pending = {EXTRA} — a tap whose key-up is missed
    release();
    await sweep;
    await flush();

    // The follow-up validated EXTRA, found it stale, pruned it — and since the
    // trigger didn't survive, the prune is a key-up: {A} is exactly PTT but
    // must NOT latch. A's masked press is lost (fail-safe direction).
    expect(recheckPressedKeys).toHaveBeenCalledTimes(2);
    expect(internals.getActiveKeys()).toEqual([A]);
    expect(timeline).toEqual([]);

    // The set is clean now, so one re-press recovers.
    internals.removeActiveKey(A);
    internals.addActiveKey(A);
    expect(timeline).toEqual(["press"]);
  });

  it("an overwriting trigger released (delivered) before the follow-up cannot latch", async () => {
    const physicallyDown = new Set<number>(); // PHANTOM stuck
    const { manager, internals, timeline, recheckPressedKeys, release } =
      createGated(physicallyDown);
    usePttShortcut(internals); // PTT = [A]

    internals.addActiveKey(PHANTOM); // {P}
    const sweep = manager.maybeRecheckPressedKeys(); // held in flight over [P]
    physicallyDown.add(A);
    internals.addActiveKey(A); // pending = {A}
    physicallyDown.add(EXTRA);
    internals.addActiveKey(EXTRA); // pending = {EXTRA}
    physicallyDown.delete(EXTRA);
    internals.removeActiveKey(EXTRA); // released, key-up DELIVERED → {P,A}
    release();
    await sweep;
    await flush();

    // The follow-up's trigger (EXTRA) is no longer held → not survived → the
    // sweep's prune of P collapsed to {A} as a key-up only.
    expect(recheckPressedKeys).toHaveBeenCalledTimes(2);
    expect(internals.getActiveKeys()).toEqual([A]);
    expect(timeline).toEqual([]);
  });

  it("the chord-completing key is the recorded trigger and carries the latch", async () => {
    // PTT = [A,B]. Only the key-down that completes the chord can satisfy the
    // strict-superset condition, so it is naturally the recorded (latest)
    // trigger — the same key a clean event stream would have latched on.
    const physicallyDown = new Set<number>(); // PHANTOM stuck
    const { manager, internals, timeline, recheckPressedKeys, release } =
      createGated(physicallyDown);
    usePttShortcut(internals, [A, B]);

    internals.addActiveKey(PHANTOM); // {P}
    const sweep = manager.maybeRecheckPressedKeys(); // held in flight over [P]
    physicallyDown.add(A);
    internals.addActiveKey(A); // {P,A} — not a superset of [A,B]: records nothing
    physicallyDown.add(B);
    internals.addActiveKey(B); // {P,A,B} — superset → pending = {B}
    release();
    await sweep;
    await flush();

    // Sweep pruned P as a key-up (no latch there); the follow-up validated B —
    // the chord-completing press — against fresh OS truth and latched.
    expect(recheckPressedKeys).toHaveBeenCalledTimes(2);
    expect(internals.getActiveKeys()).toEqual([A, B]);
    expect(timeline).toEqual(["press"]);
  });
});
