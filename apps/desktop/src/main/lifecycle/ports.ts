import type { SealedOutcome, SessionId } from "./types";

/**
 * Ports — the shell's only exits. Every method is fire-and-forget: a port
 * never returns results, it reports facts back through the sink it was
 * constructed with (effects-as-events). Facts must be keyed to the session
 * the work was spawned for; the reducer fences stale sessions (Rule 0), so
 * a laggard port can never touch a successor session.
 */

/** Fact sink handed to every port at construction. */
export type LifecycleFactSink = (fact: LifecyclePortFact) => void;

/** The facts ports are allowed to report. */
export type LifecyclePortFact =
  | { type: "recorderReady"; session: SessionId }
  | { type: "recorderFailed"; session: SessionId; cause: string }
  | { type: "recorderClosed"; session: SessionId }
  | { type: "noAudioDetected"; session: SessionId }
  | {
      type: "transcriptionFinal";
      session: SessionId;
      result:
        | { kind: "text"; text: string }
        | { kind: "empty" }
        | { kind: "failure"; cause: string };
    }
  | { type: "storageFinished"; session: SessionId }
  | { type: "deliveryStaged"; session: SessionId };

/**
 * Capture. Owns streaming custody (WAV from first byte + provisional row),
 * the dead-mic bound (wall clock from recorderReady → noAudioDetected), and
 * the stop drain (recorderClosed exactly once per session).
 */
export interface RecorderPort {
  /** → recorderReady | recorderFailed. */
  start(session: SessionId): void;
  /** Begin drain; → recorderClosed exactly once. Safe on unknown sessions. */
  stop(session: SessionId): void;
}

/**
 * Transcription. The port opens and feeds its own stream during capture
 * (frames bypass the queue); the shell only tells it how the session ends.
 */
export interface TranscriptionPort {
  /** Close the stream and resolve; never-fed sessions synthesize empty. → transcriptionFinal. */
  finalize(session: SessionId): void;
  /** Abandon the stream; no fact expected. Safe on unknown sessions. */
  cancel(session: SessionId): void;
}

/**
 * Persistence. Stamps the sealed outcome onto the session's provisional row
 * (status-CAS + transcript + keep/delete decision).
 */
export interface StoragePort {
  /** → storageFinished on success AND on failure (unpayloaded, D15). */
  commit(session: SessionId, sealed: SealedOutcome): void;
}

/**
 * Delivery. The single front door out of the lifecycle: paste, or stage a
 * draft for review. Runs only after the record is committed (R7).
 */
export interface HostPort {
  /** → deliveryStaged (also on failed/aborted staging; the row is already safe). */
  stageDelivery(session: SessionId, sealed: SealedOutcome): void;
}

export interface LifecyclePorts {
  recorder: RecorderPort;
  transcription: TranscriptionPort;
  storage: StoragePort;
  host: HostPort;
}
