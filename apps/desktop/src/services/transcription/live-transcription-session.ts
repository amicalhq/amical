import { Cause, Deferred, Effect, Exit, Fiber, FiberId, Option } from "effect";
import type { RuntimeFiber } from "effect/Fiber";
import { runFork, runPromise } from "../../main/runtime/telemetry-runtime";
import type {
  MaterializedTranscriptionSession,
  StreamingSessionUpdate,
} from "./types";

type LiveSessionPhase = "open" | "finishing" | "aborted" | "retired";

const isEmptyUpdate = (update: StreamingSessionUpdate): boolean =>
  update.accessibilityContext === undefined && update.isInstruct === undefined;

const applyUpdate = (
  session: MaterializedTranscriptionSession,
  update: StreamingSessionUpdate,
): void => {
  if (update.accessibilityContext !== undefined) {
    session.context.accessibilityContext = update.accessibilityContext;
  }
  if (update.isInstruct !== undefined) {
    session.context.isInstruct = update.isInstruct;
  }
};

/**
 * Owns admission, draining, abort, and retirement for one live recording.
 *
 * v2: admitted chunk work runs as fibers in a per-session ledger on the
 * shared telemetry runtime. Abort and retirement interrupt the ledger —
 * fired, never awaited, so the synchronous cancel path stays zero-tick. The
 * public surface is unchanged and stays synchronous; the promise returned by
 * processChunk settles exactly as before: same-object rejection for a
 * terminal failure, empty string for cancelled work.
 */
export class LiveTranscriptionSession {
  private readonly abortController = new AbortController();
  private phase: LiveSessionPhase = "open";
  private readonly ledger = new Set<RuntimeFiber<string, unknown>>();
  private readonly abortGate = Deferred.unsafeMake<void>(FiberId.none);
  private pendingUpdate: StreamingSessionUpdate = {};
  private materialized: MaterializedTranscriptionSession | null = null;
  private providerCancelled = false;
  private terminalError: Error | null = null;

  constructor(
    readonly id: string,
    private readonly onTerminalFailure?: (error: Error) => void,
  ) {}

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get materializedSession(): MaterializedTranscriptionSession | null {
    return this.materialized;
  }

  /** Test support: fibers currently tracked in the ledger. */
  openWorkCount(): number {
    return this.ledger.size;
  }

  private acceptsChunks(): boolean {
    return this.phase === "open" && !this.terminalError;
  }

  canCompleteAdmittedWork(): boolean {
    return (
      !this.terminalError &&
      (this.phase === "open" || this.phase === "finishing")
    );
  }

  processChunk(work: () => Promise<string>): Promise<string> {
    return this.processChunkEffect(
      Effect.tryPromise({ try: work, catch: (error) => error }),
    );
  }

  /**
   * Admit one chunk of work as a ledger fiber.
   *
   * Failure classification runs INSIDE the chunk effect, with the re-fail in
   * the same uninterruptible region: when the failing chunk's callback
   * retires this session, the retirement interrupts this very fiber, and an
   * interruptible tail would lose the original error (the cause would end
   * interruption-only). Probe-verified against effect 3.22.1 (plan D8).
   */
  processChunkEffect(work: Effect.Effect<string, unknown>): Promise<string> {
    if (!this.acceptsChunks()) {
      return Promise.resolve("");
    }

    const classified = work.pipe(
      Effect.catchAllCause((cause) =>
        Effect.uninterruptible(
          Effect.suspend(() => {
            if (this.phase === "aborted" || this.phase === "retired") {
              // Phase is read at failure time, exactly like the old catch:
              // failures after abort/retire are swallowed, never terminal.
              return Effect.succeed("");
            }
            const failure = Cause.failureOption(cause);
            const defect = Cause.dieOption(cause);
            // Branch on PRESENCE, not value: a rejection whose value is
            // literally null must still latch (review finding — a null
            // sentinel here misrouted Fail(null) into the interruption arm).
            if (Option.isSome(failure)) {
              this.reportTerminalFailure(Cause.originalError(failure.value));
            } else if (Option.isSome(defect)) {
              this.reportTerminalFailure(Cause.originalError(defect.value));
            }
            // Pure interruption falls through without latching.
            return Effect.failCause(cause);
          }),
        ),
      ),
    );

    // Registration discipline (plan D6, session-work precedent): fork, insert
    // into the ledger, attach the observer, then re-check the phase — the
    // fork can complete, or this session can retire, before runFork returns.
    const fiber = runFork(classified);
    this.ledger.add(fiber);
    const exitPromise = new Promise<Exit.Exit<string, unknown>>((resolve) => {
      fiber.addObserver((exit) => {
        this.ledger.delete(fiber);
        resolve(exit);
      });
    });
    if (this.phase === "aborted" || this.phase === "retired") {
      fiber.unsafeInterruptAsFork(FiberId.none);
    }

    return exitPromise.then((exit) => {
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      const failure = Cause.failureOption(exit.cause);
      if (Option.isSome(failure)) {
        throw Cause.originalError(failure.value);
      }
      const defect = Cause.dieOption(exit.cause);
      if (Option.isSome(defect)) {
        throw Cause.originalError(defect.value);
      }
      // Interrupted chunk work settles as the empty string the pinned
      // cancellation behavior requires.
      return "";
    });
  }

  closeChunkAdmission(): void {
    if (this.phase === "open") {
      this.phase = "finishing";
    }
  }

  async drainAdmittedChunks(): Promise<void> {
    if (this.signal.aborted) {
      return;
    }

    // Snapshot semantics: await only the fibers admitted before this call.
    const admitted = [...this.ledger];
    if (admitted.length === 0) {
      return;
    }
    await runPromise(
      Effect.race(
        Fiber.awaitAll(admitted).pipe(Effect.asVoid),
        Deferred.await(this.abortGate),
      ),
    );
  }

  updateSnapshot(
    update: StreamingSessionUpdate,
  ): MaterializedTranscriptionSession | null {
    if (!this.acceptsChunks() || isEmptyUpdate(update)) {
      return null;
    }

    if (!this.materialized) {
      this.pendingUpdate = { ...this.pendingUpdate, ...update };
      return null;
    }

    applyUpdate(this.materialized, update);
    return this.materialized;
  }

  attach(session: MaterializedTranscriptionSession): boolean {
    if (!this.canCompleteAdmittedWork()) {
      session.providerSession.cancel();
      return false;
    }

    applyUpdate(session, this.pendingUpdate);
    this.pendingUpdate = {};
    this.materialized = session;
    return true;
  }

  canPushContextTo(session: MaterializedTranscriptionSession): boolean {
    return this.acceptsChunks() && this.materialized === session;
  }

  /** Latch the first unrecoverable failure for this recording. */
  latchTerminalFailure(error: unknown): Error | null {
    if (
      this.terminalError ||
      this.phase === "aborted" ||
      this.phase === "retired"
    ) {
      return null;
    }

    const terminalError =
      error instanceof Error ? error : new Error(String(error));
    this.terminalError = terminalError;
    return terminalError;
  }

  reportTerminalFailure(error: unknown): void {
    const terminalError = this.latchTerminalFailure(error);
    if (!terminalError) {
      return;
    }

    this.onTerminalFailure?.(terminalError);
  }

  throwIfTerminalFailure(): void {
    if (this.terminalError) {
      throw this.terminalError;
    }
  }

  requestAbort(): void {
    if (this.phase === "retired") {
      return;
    }

    this.phase = "aborted";
    if (!this.signal.aborted) {
      this.abortController.abort();
    }
    this.cancelProviderOnce();
    this.interruptLedger();
    Deferred.unsafeDone(this.abortGate, Exit.void);
  }

  retire(): void {
    if (this.phase === "retired") {
      return;
    }

    this.phase = "retired";
    this.cancelProviderOnce();
    this.materialized = null;
    this.pendingUpdate = {};
    this.interruptLedger();
  }

  private interruptLedger(): void {
    // Fired, never awaited (plan D3): an awaited interrupt would block the
    // synchronous cancel path behind uninterruptible provider work.
    for (const fiber of this.ledger) {
      fiber.unsafeInterruptAsFork(FiberId.none);
    }
  }

  private cancelProviderOnce(): void {
    if (this.providerCancelled || !this.materialized) {
      return;
    }

    this.providerCancelled = true;
    this.materialized.providerSession.cancel();
  }
}
