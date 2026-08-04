import type { GetAccessibilityContextResult } from "@amical/types";
import type { StreamingSession } from "../../pipeline/core/pipeline-types";

export type StreamingSessionUpdate = {
  accessibilityContext?: GetAccessibilityContextResult | null;
  isInstruct?: boolean;
};

type LiveSessionPhase = "open" | "finishing" | "aborted" | "retired";

const isEmptyUpdate = (update: StreamingSessionUpdate): boolean =>
  update.accessibilityContext === undefined && update.isInstruct === undefined;

const applyUpdate = (
  session: StreamingSession,
  update: StreamingSessionUpdate,
): void => {
  if (update.accessibilityContext !== undefined) {
    session.context.sharedData.accessibilityContext =
      update.accessibilityContext;
  }
  if (update.isInstruct !== undefined) {
    session.context.metadata.set("isInstruct", update.isInstruct);
  }
};

/** Owns admission, draining, abort, and retirement for one live recording. */
export class LiveTranscriptionSession {
  private readonly abortController = new AbortController();
  private phase: LiveSessionPhase = "open";
  private chunkTail: Promise<void> = Promise.resolve();
  private pendingUpdate: StreamingSessionUpdate = {};
  private materialized: StreamingSession | null = null;
  private providerCancelled = false;

  constructor(readonly id: string) {}

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get materializedSession(): StreamingSession | null {
    return this.materialized;
  }

  private acceptsChunks(): boolean {
    return this.phase === "open";
  }

  canCompleteAdmittedWork(): boolean {
    return this.phase === "open" || this.phase === "finishing";
  }

  processChunk(work: () => Promise<string>): Promise<string> {
    if (!this.acceptsChunks()) {
      return Promise.resolve("");
    }

    const admittedWork = work().catch((error: unknown) => {
      if (!this.canCompleteAdmittedWork()) {
        return "";
      }
      throw error;
    });
    const settledWork = admittedWork.then(
      () => undefined,
      () => undefined,
    );
    this.chunkTail = Promise.all([this.chunkTail, settledWork]).then(
      () => undefined,
    );
    return admittedWork;
  }

  closeChunkAdmission(): void {
    if (this.phase === "open") {
      this.phase = "finishing";
    }
  }

  async drainAdmittedChunks(): Promise<void> {
    const admittedChunks = this.chunkTail;
    if (this.signal.aborted) {
      return;
    }

    const abort = Promise.withResolvers<void>();
    const onAbort = () => abort.resolve();
    this.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await Promise.race([admittedChunks, abort.promise]);
    } finally {
      this.signal.removeEventListener("abort", onAbort);
    }
  }

  updateSnapshot(update: StreamingSessionUpdate): StreamingSession | null {
    if (this.phase !== "open" || isEmptyUpdate(update)) {
      return null;
    }

    if (!this.materialized) {
      this.pendingUpdate = { ...this.pendingUpdate, ...update };
      return null;
    }

    applyUpdate(this.materialized, update);
    return this.materialized;
  }

  attach(session: StreamingSession): boolean {
    if (!this.canCompleteAdmittedWork()) {
      session.providerSession.cancel();
      return false;
    }

    applyUpdate(session, this.pendingUpdate);
    this.pendingUpdate = {};
    this.materialized = session;
    return true;
  }

  canPushContextTo(session: StreamingSession): boolean {
    return this.phase === "open" && this.materialized === session;
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
  }

  retire(): void {
    if (this.phase === "retired") {
      return;
    }

    this.phase = "retired";
    this.cancelProviderOnce();
    this.materialized = null;
    this.pendingUpdate = {};
  }

  private cancelProviderOnce(): void {
    if (this.providerCancelled || !this.materialized) {
      return;
    }

    this.providerCancelled = true;
    this.materialized.providerSession.cancel();
  }
}
