import { MAC_KEYCODES, WINDOWS_KEYCODES } from "../../utils/keycodes";
import {
  MAC_MODIFIER_KEYCODES,
  WINDOWS_MODIFIER_KEYCODES,
} from "../../utils/shortcut-constants";
import { wordForms } from "./candidates";
import type {
  EditTracker,
  EditTrackerDeps,
  EditTrackerEndReason,
  EditTrackerOptions,
  EditTrackerResult,
  KeyDown,
  TimerHandle,
  TrackerPlatform,
  WatchRead,
} from "./types";

// Edit tracker: a pure state machine over reads of the watched field, key
// downs and end triggers. The clock, timers and the reader are injected.
// Field text is never logged; it leaves this module only in the result and
// to the pure wordForms helper.

const FIRST_READ_DELAY_MS = 250;
const KEY_READ_DELAY_MS = 50;
const PERIODIC_READ_MS = 1000;
const MIN_READ_GAP_MS = 100;
const LOCATE_DEADLINE_MS = 2000;
const WINDOW_MS = 60_000;
const MAX_CONSECUTIVE_READ_ERRORS = 3;

// ---------------------------------------------------------------------------
// Key classification
// ---------------------------------------------------------------------------

interface PlatformKeys {
  enter: ReadonlySet<number>;
  /** Keys that never edit: navigation, function and modifier keys. */
  nonEditing: ReadonlySet<number>;
  /** Keys that still edit with Cmd or Ctrl held. */
  commandExceptions: ReadonlySet<number>;
  undo: number;
}

function functionKeyCodes(table: Record<string, number>): number[] {
  return Object.entries(table)
    .filter(([name]) => /^F\d+$/.test(name))
    .map(([, code]) => code);
}

const MAC_KEYS: PlatformKeys = {
  enter: new Set([
    MAC_KEYCODES.ENTER,
    MAC_KEYCODES.ENTER_LEGACY,
    MAC_KEYCODES.KEYPAD_ENTER,
  ]),
  nonEditing: new Set([
    MAC_KEYCODES.LEFT,
    MAC_KEYCODES.RIGHT,
    MAC_KEYCODES.UP,
    MAC_KEYCODES.DOWN,
    MAC_KEYCODES.HOME,
    MAC_KEYCODES.END,
    MAC_KEYCODES.PAGE_UP,
    MAC_KEYCODES.PAGE_DOWN,
    ...MAC_MODIFIER_KEYCODES,
    ...functionKeyCodes(MAC_KEYCODES),
  ]),
  commandExceptions: new Set([
    MAC_KEYCODES.DELETE,
    MAC_KEYCODES.FORWARD_DELETE,
    MAC_KEYCODES.Z,
    MAC_KEYCODES.X,
    MAC_KEYCODES.V,
    MAC_KEYCODES.Y,
  ]),
  undo: MAC_KEYCODES.Z,
};

const WINDOWS_KEYS: PlatformKeys = {
  enter: new Set([WINDOWS_KEYCODES.ENTER]),
  nonEditing: new Set([
    WINDOWS_KEYCODES.LEFT,
    WINDOWS_KEYCODES.RIGHT,
    WINDOWS_KEYCODES.UP,
    WINDOWS_KEYCODES.DOWN,
    WINDOWS_KEYCODES.HOME,
    WINDOWS_KEYCODES.END,
    WINDOWS_KEYCODES.PAGE_UP,
    WINDOWS_KEYCODES.PAGE_DOWN,
    ...WINDOWS_MODIFIER_KEYCODES,
    ...functionKeyCodes(WINDOWS_KEYCODES),
  ]),
  commandExceptions: new Set([
    WINDOWS_KEYCODES.BACKSPACE,
    WINDOWS_KEYCODES.DELETE,
    WINDOWS_KEYCODES.Z,
    WINDOWS_KEYCODES.X,
    WINDOWS_KEYCODES.V,
    WINDOWS_KEYCODES.Y,
  ]),
  undo: WINDOWS_KEYCODES.Z,
};

function keysFor(platform: TrackerPlatform): PlatformKeys {
  return platform === "darwin" ? MAC_KEYS : WINDOWS_KEYS;
}

export function isEnterKey(key: KeyDown, platform: TrackerPlatform): boolean {
  return keysFor(platform).enter.has(key.keyCode);
}

export function isEditingKey(key: KeyDown, platform: TrackerPlatform): boolean {
  const keys = keysFor(platform);
  if (keys.enter.has(key.keyCode) || keys.nonEditing.has(key.keyCode)) {
    return false;
  }
  if (
    (key.metaKey || key.ctrlKey) &&
    !keys.commandExceptions.has(key.keyCode)
  ) {
    return false;
  }
  return true;
}

function isUndoKey(key: KeyDown, platform: TrackerPlatform): boolean {
  return (key.metaKey || key.ctrlKey) && key.keyCode === keysFor(platform).undo;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

// Same normalization as the Windows helper applies to every text read.
function normalizeWindowsText(text: string): string {
  return text
    .replace(/[\uFEFF\uFFFC]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function distanceUnits(text: string): string[] {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  return Array.from(graphemes.segment(normalized), (s) => s.segment);
}

// One far test runs on the main thread, up to 10 times a second. 4 M cells
// (about 2 000 x 2 000 graphemes) take about 13 ms. Past that, only the length
// bound decides; a same-length replacement of a long region then reaches
// extraction, where the rewrite guard rejects it.
const MAX_DISTANCE_CELLS = 4_000_000;

/** Edit distance, or null when the changed part is too large to compare. */
function levenshtein(fullA: string[], fullB: string[]): number | null {
  // A common prefix or suffix does not change the distance: strip it.
  let start = 0;
  while (
    start < fullA.length &&
    start < fullB.length &&
    fullA[start] === fullB[start]
  ) {
    start++;
  }
  let endA = fullA.length;
  let endB = fullB.length;
  while (endA > start && endB > start && fullA[endA - 1] === fullB[endB - 1]) {
    endA--;
    endB--;
  }
  const a = fullA.slice(start, endA);
  const b = fullB.slice(start, endB);
  if (a.length * b.length > MAX_DISTANCE_CELLS) {
    return null;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// "Far" test over distance units: more than half of the characters changed,
// so the region no longer holds an edit of the paste.
const FAR_DISTANCE = 0.5;

function isFar(a: string[], b: string[]): boolean {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) {
    return false;
  }
  // The length difference is a lower bound of the distance.
  if (Math.abs(a.length - b.length) / longest > FAR_DISTANCE) {
    return true;
  }
  const distance = levenshtein(a, b);
  return distance !== null && distance / longest > FAR_DISTANCE;
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

// Every other end learns from the Enter mark when there is one, else from R.
const LEARNS_NOTHING: ReadonlySet<EditTrackerEndReason> = new Set([
  "paste_undone",
  "pasted_text_not_found",
]);

/** Index of the only occurrence of `needle` in `text`, or -1. */
function uniqueIndexOf(text: string, needle: string): number {
  const first = text.indexOf(needle);
  return first >= 0 && text.indexOf(needle, first + 1) < 0 ? first : -1;
}

interface EnterMark {
  region: string;
  /** An editing key arrived after the region's read was issued. */
  stale: boolean;
}

interface PendingEnd {
  reason: EditTrackerEndReason;
  /** Take one more read and apply it before ending (session start). */
  finalRead: boolean;
}

class EditTrackerImpl implements EditTracker {
  readonly result: Promise<EditTrackerResult>;

  private resolveResult!: (result: EditTrackerResult) => void;
  private readonly pasted: string;
  private readonly platform: TrackerPlatform;
  private readonly deps: EditTrackerDeps;
  private readonly startedAt: number;
  private readonly timers = new Set<TimerHandle>();

  // Order of events: reads issued and key-downs handled.
  private sequence = 0;
  private ended = false;
  private pendingEnd: PendingEnd | null = null;
  private finalReadIssued = false;

  private inFlight = false;
  private readWanted = false;
  private gapTimer: TimerHandle | null = null;
  private lastIssuedAt = Number.NEGATIVE_INFINITY;
  private consecutiveErrors = 0;
  private locateDeadlinePassed = false;

  private readCount = 0;
  private readErrorCount = 0;
  private readMsMax = 0;
  private reanchorCount = 0;
  private rearrangedCount = 0;
  private pasteResetCount = 0;
  private enterMarkDroppedCount = 0;

  private located = false;
  private locateMs: number | null = null;
  private before = "";
  private after = "";

  // R: the last trusted region, and the order position of its read.
  private region: string;
  /** distanceUnits(region), split once per trusted region. */
  private regionUnits: string[];
  private regionSequence = 0;
  private previousRegion: string | null = null;
  private trustedReads = 0;
  private enterMark: EnterMark | null = null;

  private keyEventsSeen = false;
  private lastEditingKey: { sequence: number; undo: boolean } | null = null;

  constructor(options: EditTrackerOptions) {
    this.platform = options.platform;
    this.deps = options.deps;
    this.pasted =
      options.platform === "win32"
        ? normalizeWindowsText(options.pastedText)
        : options.pastedText;
    this.region = this.pasted;
    this.regionUnits = distanceUnits(this.pasted);
    this.startedAt = this.deps.now();
    this.result = new Promise((resolve) => {
      this.resolveResult = resolve;
    });

    this.addTimer(FIRST_READ_DELAY_MS, () => this.requestRead());
    this.schedulePeriodicRead();
    this.addTimer(WINDOW_MS, () => this.trigger("window_elapsed"));
    this.addTimer(LOCATE_DEADLINE_MS, () => {
      if (this.located) {
        return;
      }
      if (this.inFlight) {
        this.locateDeadlinePassed = true;
      } else {
        this.end("pasted_text_not_found");
      }
    });
  }

  onKeyDown(key: KeyDown): void {
    queueMicrotask(() => this.handleKeyDown(key));
  }

  onSessionStart(): void {
    this.trigger("superseded", true);
  }

  onOtherPaste(): void {
    this.trigger("superseded");
  }

  onHelperRestart(): void {
    this.trigger("helper_restart");
  }

  // --- keys ----------------------------------------------------------------

  private handleKeyDown(key: KeyDown): void {
    if (this.ended || this.pendingEnd) {
      return;
    }
    this.keyEventsSeen = true;
    const sequence = ++this.sequence;
    if (isEnterKey(key, this.platform)) {
      this.enterMark = {
        region: this.region,
        stale: this.editedSinceRegion(),
      };
    } else if (isEditingKey(key, this.platform)) {
      this.lastEditingKey = { sequence, undo: isUndoKey(key, this.platform) };
    }
    this.addTimer(KEY_READ_DELAY_MS, () => this.requestRead());
  }

  private editedSinceRegion(): boolean {
    return (
      this.lastEditingKey !== null &&
      this.lastEditingKey.sequence > this.regionSequence
    );
  }

  // --- read schedule -------------------------------------------------------

  private addTimer(ms: number, callback: () => void): TimerHandle {
    const handle = this.deps.setTimer(ms, () => {
      this.timers.delete(handle);
      if (!this.ended) {
        callback();
      }
    });
    this.timers.add(handle);
    return handle;
  }

  private schedulePeriodicRead(): void {
    this.addTimer(PERIODIC_READ_MS, () => {
      this.requestRead();
      this.schedulePeriodicRead();
    });
  }

  private requestRead(): void {
    if (this.ended || this.pendingEnd) {
      return;
    }
    if (this.inFlight) {
      this.readWanted = true;
      return;
    }
    const wait = this.lastIssuedAt + MIN_READ_GAP_MS - this.deps.now();
    if (wait > 0) {
      if (!this.gapTimer) {
        this.gapTimer = this.addTimer(wait, () => {
          this.gapTimer = null;
          this.requestRead();
        });
      }
      return;
    }
    this.startRead();
  }

  private startRead(): void {
    this.inFlight = true;
    this.readWanted = false;
    this.lastIssuedAt = this.deps.now();
    this.readCount++;
    const sequence = ++this.sequence;
    void this.deps.read().then((answer) => this.onReadAnswer(answer, sequence));
  }

  private onReadAnswer(answer: WatchRead, sequence: number): void {
    this.inFlight = false;
    if (this.ended) {
      return;
    }
    this.applyRead(answer, sequence);
    if (this.ended) {
      return;
    }
    if (this.pendingEnd) {
      this.finishPendingEnd();
      return;
    }
    if (!this.located && this.locateDeadlinePassed) {
      this.end("pasted_text_not_found");
      return;
    }
    if (this.readWanted) {
      this.requestRead();
    }
  }

  private applyRead(answer: WatchRead, sequence: number): void {
    if (answer.status === "timeout") {
      this.readErrorCount++;
      this.end("read_failed");
      return;
    }
    this.readMsMax = Math.max(this.readMsMax, answer.readMs);
    switch (answer.status) {
      case "gone":
        this.end("element_gone");
        return;
      case "unknown_watch":
        this.end("helper_restart");
        return;
      case "too_long":
        this.end("too_long");
        return;
      default:
        break;
    }
    if (answer.status === "error" || answer.text === null) {
      this.readErrorCount++;
      if (++this.consecutiveErrors >= MAX_CONSECUTIVE_READ_ERRORS) {
        this.end("read_failed");
      }
      return;
    }
    this.consecutiveErrors = 0;
    if (!this.located) {
      this.locate(answer.text, answer.selection, sequence);
      return;
    }
    this.track(answer.text, sequence);
  }

  // --- locate and track ---------------------------------------------------

  private locate(
    text: string,
    selection: { location: number; length: number } | null,
    sequence: number,
  ): void {
    const pasted = this.pasted;
    let start = -1;
    if (selection && selection.length === 0) {
      const caret = selection.location;
      if (
        caret >= pasted.length &&
        text.slice(caret - pasted.length, caret) === pasted
      ) {
        start = caret - pasted.length;
      }
    }
    if (start < 0) {
      start = uniqueIndexOf(text, pasted);
    }
    if (start < 0) {
      return;
    }
    this.located = true;
    this.locateMs = this.deps.now() - this.startedAt;
    this.anchorAt(text, start, pasted, sequence);
  }

  private anchorAt(
    text: string,
    start: number,
    region: string,
    sequence: number,
  ): void {
    this.before = text.slice(0, start);
    this.after = text.slice(start + region.length);
    this.trust(region, sequence);
  }

  private track(text: string, sequence: number): void {
    const { before, after } = this;
    const anchorsHold =
      text.length >= before.length + after.length &&
      text.startsWith(before) &&
      text.endsWith(after);
    if (!anchorsHold) {
      if (!this.relocate(text, sequence)) {
        this.end("anchors_broken");
      }
      return;
    }
    const middle = text.slice(before.length, text.length - after.length);
    const empty = middle.trim() === "";
    const edited = this.editedSinceRegion();

    if (empty && edited && this.lastEditingKey?.undo) {
      this.end("paste_undone");
      return;
    }

    if (empty || this.isFarFromRegion(middle)) {
      if (this.enterMark) {
        this.end("sent");
        return;
      }
      if (!edited) {
        if (empty || !this.isRearrangedRegion(middle)) {
          this.end("field_cleared");
          return;
        }
        this.rearrangedCount++;
      }
      // The user is deleting, moving or retyping. An empty middle is not
      // trusted.
      if (!empty) {
        this.trust(middle, sequence);
      }
      return;
    }

    this.trust(middle, sequence);
    if (this.enterMark && middle.trim() !== this.enterMark.region.trim()) {
      // The Enter was a newline, not a send.
      this.enterMark = null;
      this.enterMarkDroppedCount++;
    }
  }

  // The anchors broke. If the last trusted region is still in the field
  // exactly once, the edit was outside it: move the anchors to it and confirm
  // it at this read. Same uniqueness test as locate(). A copy of the region
  // inside the old anchor text makes a single match ambiguous (it may be the
  // copy, left after the paste was deleted), so it is not followed.
  private relocate(text: string, sequence: number): boolean {
    const region = this.region;
    if (
      region.trim() === "" ||
      this.before.includes(region) ||
      this.after.includes(region)
    ) {
      return false;
    }
    const start = uniqueIndexOf(text, region);
    if (start < 0) {
      return false;
    }
    this.anchorAt(text, start, region, sequence);
    this.reanchorCount++;
    return true;
  }

  private isFarFromRegion(text: string): boolean {
    if (text === this.region) {
      return false;
    }
    const far = isFar(distanceUnits(text), this.regionUnits);
    // The pasted text is always a valid state of the region: a key-less
    // return to it (toolbar Undo, app revert) is not a cleared field.
    if (far && text === this.pasted) {
      this.pasteResetCount++;
      return false;
    }
    return far;
  }

  // Far, no Enter mark, no editing key since R: the app cleared or replaced
  // the field, or the user cut, dragged or reordered text with the mouse.
  // App text (a placeholder, another draft, the next message) brings words R
  // does not have; a cut or a move brings none. Words keep their case, as in
  // the candidate stage, where a case change is an edit. With no key stream
  // the next message also lands here and its first word can be a word of R,
  // so a cut counts only after a key was seen; a pure reorder counts always.
  private isRearrangedRegion(text: string): boolean {
    const words = wordForms(text);
    if (words.length === 0) {
      return false;
    }
    const regionWords = wordForms(this.region);
    const counts = new Map<string, number>();
    for (const word of regionWords) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    for (const word of words) {
      const count = counts.get(word) ?? 0;
      if (count === 0) {
        return false;
      }
      counts.set(word, count - 1);
    }
    return this.keyEventsSeen || words.length === regionWords.length;
  }

  private trust(region: string, sequence: number): void {
    this.previousRegion = this.region;
    this.region = region;
    this.regionUnits = distanceUnits(region);
    this.regionSequence = sequence;
    this.trustedReads++;
  }

  // --- ends ---------------------------------------------------------------

  private trigger(reason: EditTrackerEndReason, finalRead = false): void {
    if (this.ended || this.pendingEnd) {
      return;
    }
    this.pendingEnd = { reason, finalRead };
    if (!this.inFlight) {
      this.finishPendingEnd();
    }
  }

  private finishPendingEnd(): void {
    const pending = this.pendingEnd;
    if (!pending) {
      return;
    }
    if (pending.finalRead && !this.finalReadIssued) {
      this.finalReadIssued = true;
      this.startRead();
      return;
    }
    this.end(pending.reason);
  }

  private end(reason: EditTrackerEndReason): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    for (const timer of this.timers) {
      timer.cancel();
    }
    this.timers.clear();

    let region: string | null = null;
    let stale = false;
    if (!LEARNS_NOTHING.has(reason)) {
      region = this.enterMark?.region ?? this.region;
      stale = this.enterMark?.stale ?? this.editedSinceRegion();
    }

    const changed = region !== null && region !== this.pasted;
    const stable =
      this.trustedReads >= 2 && this.previousRegion === this.region;
    const finalRegion =
      changed && !stale && (this.keyEventsSeen || stable) ? region : null;

    this.resolveResult({
      endReason: reason,
      finalRegion,
      changed,
      staleFinalState: stale,
      stableFinalState: stable,
      keyEventsSeen: this.keyEventsSeen,
      located: this.located,
      locateMs: this.locateMs,
      readCount: this.readCount,
      readErrorCount: this.readErrorCount,
      readMsMax: this.readMsMax,
      durationMs: this.deps.now() - this.startedAt,
      reanchorCount: this.reanchorCount,
      rearrangedCount: this.rearrangedCount,
      pasteResetCount: this.pasteResetCount,
      enterMarkDroppedCount: this.enterMarkDroppedCount,
    });
  }
}

export function createEditTracker(options: EditTrackerOptions): EditTracker {
  return new EditTrackerImpl(options);
}
