import type { EditWatchReadStatus, EditWatchSelection } from "@amical/types";

// Shared types for vocabulary learning: the edit tracker (edit-tracker.ts),
// the candidate extraction (candidates.ts) and the service that wires them
// (service.ts). Pure modules depend only on these types and injected
// functions, so they can be tested with fakes.

// ---------------------------------------------------------------------------
// Reads and key events
// ---------------------------------------------------------------------------

/** One answer to a readEditWatch call, or a desktop-side RPC timeout. */
export type WatchRead =
  | {
      status: EditWatchReadStatus;
      text: string | null;
      selection: EditWatchSelection | null;
      readMs: number;
    }
  | { status: "timeout" };

/** A key-down from the native helper's key stream (key code only). */
export interface KeyDown {
  keyCode: number;
  metaKey: boolean;
  ctrlKey: boolean;
}

export type TrackerPlatform = "darwin" | "win32";

// ---------------------------------------------------------------------------
// Edit tracker
// ---------------------------------------------------------------------------

export type EditTrackerEndReason =
  | "sent"
  | "field_cleared"
  | "paste_undone"
  | "anchors_broken"
  | "window_elapsed"
  | "superseded"
  | "too_long"
  | "element_gone"
  | "read_failed"
  | "helper_restart"
  | "pasted_text_not_found";

export interface EditTrackerResult {
  endReason: EditTrackerEndReason;
  /**
   * The final region to learn from, or null when nothing may be learned
   * (no change, stale or unstable final state, or an end that learns nothing).
   */
  finalRegion: string | null;
  /** True when the final region differs from the pasted text. */
  changed: boolean;
  staleFinalState: boolean;
  /** Only meaningful when no key stream was seen. */
  stableFinalState: boolean;
  keyEventsSeen: boolean;
  located: boolean;
  locateMs: number | null;
  readCount: number;
  readErrorCount: number;
  readMsMax: number;
  durationMs: number;
  /** Anchors broke and the watch continued on the intact region. */
  reanchorCount: number;
  /** A far step with no new word was kept as the user's cut or move. */
  rearrangedCount: number;
  /** A far step back to the pasted text was kept, not ended. */
  pasteResetCount: number;
  /** An Enter turned out to be a newline, not a send. */
  enterMarkDroppedCount: number;
}

export interface TimerHandle {
  cancel(): void;
}

export interface EditTrackerDeps {
  /** Monotonic clock in milliseconds. */
  now(): number;
  /** Run `callback` after `ms` milliseconds unless cancelled. */
  setTimer(ms: number, callback: () => void): TimerHandle;
  /** One readEditWatch call. Never rejects: RPC timeouts map to "timeout". */
  read(): Promise<WatchRead>;
}

export interface EditTrackerOptions {
  pastedText: string;
  platform: TrackerPlatform;
  deps: EditTrackerDeps;
}

export interface EditTracker {
  /** A key-down from the helper. Handled one microtask late. */
  onKeyDown(key: KeyDown): void;
  /** The next dictation session started: final read, then end "superseded". */
  onSessionStart(): void;
  /** Another paste (draft confirm, paste-last) ran: end "superseded" at once. */
  onOtherPaste(): void;
  /** The native helper exited or restarted: end "helper_restart". */
  onHelperRestart(): void;
  /** Resolves once, when the watch ends. */
  readonly result: Promise<EditTrackerResult>;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface Candidate {
  /** Edited tokens, edge punctuation removed, case kept. */
  term: string;
  /** Pasted tokens of the same run. */
  heard: string;
}

export interface StepCounts {
  m: number;
  c: number;
  d: number;
  i: number;
}

export interface CandidateExtraction {
  steps: StepCounts;
  /** True when the rewrite guard fired; candidates is then empty. */
  rewrite: boolean;
  candidates: Candidate[];
}

export type CandidateDropReason =
  | "shape"
  | "length"
  | "known"
  | "cjk"
  | "duplicate"
  | "cap";

export interface CandidateFilterResult {
  kept: Candidate[];
  dropped: Record<CandidateDropReason, number>;
}
