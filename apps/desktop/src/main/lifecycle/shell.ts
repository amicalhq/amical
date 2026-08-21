import type {
  BoundStage,
  CancelReason,
  LifecycleCommand,
  LifecycleEvent,
  LifecycleState,
  SessionId,
} from "./types";
import { INITIAL_LIFECYCLE_STATE } from "./types";
import { transitionLifecycle } from "./machine";
import type { LifecycleProjection } from "./projection";
import { projectLifecycle } from "./projection";
import type { LifecycleFactSink, LifecyclePorts } from "./ports";
import type { LifecycleTuning } from "./tuning";

/**
 * L1 shell — the only impure layer around the reducer.
 *
 * Owns exactly four things:
 *  1. the single serialized event queue (queue order + row legality IS the
 *     precedence law — nothing else arbitrates races);
 *  2. verb stamping (startRequested mints a fresh session, every other verb
 *     is stamped with the live session; facts arrive port-keyed);
 *  3. stage bounds (one per stage, armed/cancelled on stage transitions,
 *     firing as `expired` events — never as commands);
 *  4. command routing to ports and snapshot publication (projection +
 *     inert session metadata), published between commit and dispatch.
 */

export interface ShellTimerHost {
  set(ms: number, fire: () => void): unknown;
  clear(handle: unknown): void;
}

export const REAL_TIMER_HOST: ShellTimerHost = {
  set: (ms, fire) => setTimeout(fire, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface LifecycleSnapshot<M extends object> {
  sessionId: SessionId | null;
  projection: LifecycleProjection;
  /** Inert session metadata (mode, draft latch, …): never read by the reducer. */
  metadata: M | null;
}

export interface LifecycleShellDeps {
  /** Ports are constructed around the shell's own fact sink. */
  ports: (sink: LifecycleFactSink) => LifecyclePorts;
  tuning: LifecycleTuning;
  mintSession: () => SessionId;
  timers?: ShellTimerHost;
  /** Observability tap: every non-noop transition, before publication. */
  onTransition?: (
    event: LifecycleEvent,
    before: LifecycleState,
    after: LifecycleState,
    commands: LifecycleCommand[],
  ) => void;
  /** A port threw synchronously; the shell never lets that wedge the queue. */
  onPortError?: (command: LifecycleCommand, error: unknown) => void;
}

export interface LifecycleShell<M extends object> {
  requestStart(metadata: M): SessionId;
  requestStop(): void;
  requestDismiss(): void;
  requestCancel(reason: CancelReason): void;
  /** Backstop only (R10): reset to IDLE, then best-effort port teardown. */
  forceReset(): void;
  /** Merge inert metadata into the live session; no-op when idle. */
  updateMetadata(patch: Partial<M>): void;
  getSnapshot(): LifecycleSnapshot<M>;
  getState(): LifecycleState;
  onSnapshot(listener: (snapshot: LifecycleSnapshot<M>) => void): () => void;
}

function stageOf(state: LifecycleState): BoundStage | null {
  switch (state.tag) {
    case "IDLE":
      return null;
    case "STARTING":
      return "starting";
    case "RECORDING":
      return "recording";
    case "RESOLVING":
      return "resolving";
    case "SETTLING":
      return state.stage;
  }
}

function sessionOf(state: LifecycleState): SessionId | null {
  return state.tag === "IDLE" ? null : state.session;
}

function sameProjection(a: LifecycleProjection, b: LifecycleProjection) {
  if (
    a.publicState !== b.publicState ||
    a.stopKind !== b.stopKind ||
    a.stopOrigin !== b.stopOrigin
  ) {
    return false;
  }
  // Terminal is written once at the seal and never mutated after (R5), so
  // reference identity is the correct comparison for a same-session state.
  return a.terminal === b.terminal;
}

export function createLifecycleShell<M extends object>(
  deps: LifecycleShellDeps,
): LifecycleShell<M> {
  const timers = deps.timers ?? REAL_TIMER_HOST;

  let state: LifecycleState = INITIAL_LIFECYCLE_STATE;
  let metadata: M | null = null;
  /** Minted-session → metadata, adopted at STARTING entry. Entries are
   * deleted when their startRequested event is processed (admitted or not),
   * so re-entrant mints queued behind other events cannot lose theirs. */
  const pendingStart = new Map<SessionId, M>();

  let armed: { stage: BoundStage; session: SessionId; handle: unknown } | null =
    null;

  const listeners = new Set<(snapshot: LifecycleSnapshot<M>) => void>();
  let published: LifecycleSnapshot<M> = {
    sessionId: null,
    projection: projectLifecycle(state),
    metadata: null,
  };

  const queue: LifecycleEvent[] = [];
  let draining = false;

  const ports = deps.ports((fact) => dispatch(fact));

  function dispatch(event: LifecycleEvent): void {
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        step(next);
      }
    } finally {
      draining = false;
    }
  }

  function step(event: LifecycleEvent): void {
    const before = state;
    const { state: after, commands } = transitionLifecycle(before, event);
    const noop = after === before && commands.length === 0;
    if (!noop) {
      deps.onTransition?.(event, before, after, commands);
      state = after;
      syncMetadata(after);
      syncStageBound(after);
      publish();
      for (const command of commands) {
        route(command);
      }
    }
    if (event.type === "startRequested") {
      pendingStart.delete(event.session);
    }
  }

  function syncMetadata(after: LifecycleState): void {
    const session = sessionOf(after);
    if (session === null) {
      metadata = null;
      return;
    }
    const minted = pendingStart.get(session);
    if (minted !== undefined) {
      metadata = minted;
    }
  }

  function syncStageBound(after: LifecycleState): void {
    const stage = stageOf(after);
    const session = sessionOf(after);
    if (armed && (armed.stage !== stage || armed.session !== session)) {
      timers.clear(armed.handle);
      armed = null;
    }
    if (stage !== null && session !== null && armed === null) {
      const handle = timers.set(deps.tuning.stageBoundsMs[stage], () => {
        armed = null;
        dispatch({ type: "expired", session, stage });
      });
      armed = { stage, session, handle };
    }
  }

  function publish(): void {
    const snapshot: LifecycleSnapshot<M> = {
      sessionId: sessionOf(state),
      projection: projectLifecycle(state),
      metadata,
    };
    if (
      snapshot.sessionId === published.sessionId &&
      snapshot.metadata === published.metadata &&
      sameProjection(snapshot.projection, published.projection)
    ) {
      return;
    }
    published = snapshot;
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function route(command: LifecycleCommand): void {
    try {
      switch (command.type) {
        case "startRecorder":
          ports.recorder.start(command.session);
          break;
        case "stopRecorder":
          ports.recorder.stop(command.session);
          break;
        case "finalizeTranscription":
          ports.transcription.finalize(command.session);
          break;
        case "cancelTranscription":
          ports.transcription.cancel(command.session);
          break;
        case "commitDisposition":
          ports.storage.commit(command.session, command.sealed);
          break;
        case "emitHandoff":
          ports.host.stageDelivery(command.session, command.sealed);
          break;
      }
    } catch (error) {
      deps.onPortError?.(command, error);
    }
  }

  return {
    requestStart(startMetadata: M): SessionId {
      const session = deps.mintSession();
      pendingStart.set(session, startMetadata);
      dispatch({ type: "startRequested", session });
      return session;
    },
    requestStop(): void {
      const session = sessionOf(state);
      if (session !== null) dispatch({ type: "stopRequested", session });
    },
    requestDismiss(): void {
      const session = sessionOf(state);
      if (session !== null) dispatch({ type: "dismissRequested", session });
    },
    requestCancel(reason: CancelReason): void {
      const session = sessionOf(state);
      if (session !== null) {
        dispatch({ type: "cancelRequested", session, reason });
      }
    },
    forceReset(): void {
      const session = sessionOf(state);
      dispatch({ type: "forceReset" });
      if (session !== null) {
        // R10: the injector owns teardown. Best effort; ports fence stale
        // sessions themselves, so a double stop/cancel is a no-op.
        try {
          ports.recorder.stop(session);
        } catch (error) {
          deps.onPortError?.({ type: "stopRecorder", session }, error);
        }
        try {
          ports.transcription.cancel(session);
        } catch (error) {
          deps.onPortError?.({ type: "cancelTranscription", session }, error);
        }
      }
    },
    updateMetadata(patch: Partial<M>): void {
      if (sessionOf(state) === null || metadata === null) return;
      metadata = { ...metadata, ...patch };
      publish();
    },
    getSnapshot(): LifecycleSnapshot<M> {
      return published;
    },
    getState(): LifecycleState {
      return state;
    },
    onSnapshot(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
