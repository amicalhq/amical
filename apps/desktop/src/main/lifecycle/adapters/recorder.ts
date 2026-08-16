import { logger } from "../../logger";
import { StreamingWavWriter } from "../../../utils/streaming-wav-writer";
import type { LifecycleFactSink, RecorderPort } from "../ports";
import type { SessionId } from "../types";
import type { LifecycleTuning } from "../tuning";
import { REAL_TIMER_HOST, type ShellTimerHost } from "../shell";

/**
 * RecorderPort — owns capture custody on the main-process side.
 *
 * The renderer is the far side of this port: it observes the published
 * lifecycle state ("starting" acquires the microphone, "stopping" flushes),
 * reports capture start/failure over tRPC, and streams PCM frames over IPC.
 * This adapter turns that traffic into port facts:
 *
 *   captureStarted      → recorderReady   (public recording = capture-confirmed)
 *   captureStartFailed  → recorderFailed
 *   no frame within the dead-mic bound of recorderReady → noAudioDetected
 *   final chunk, or the drain bound after stop() → recorderClosed, exactly once
 *
 * Custody: WAV streamed from the first frame (crash leaves a playable file)
 * plus the provisional row. The dead-mic watchdog keys on liveness — frames
 * arriving from the capture pipeline (D18) — so a thinking pause can never
 * kill a live session; audio content is never judged here.
 */

const SAMPLE_RATE = 16_000;

export interface AmbianceContext {
  systemAudioMuted: boolean;
  soundsMuted: boolean;
}

/**
 * Session ambiance: the native start/stop sounds and system-audio mute.
 * `beepGate` resolves once captured frames are no longer contaminated by the
 * start sound (immediately when dictation sounds are muted).
 */
export interface RecorderAmbiance {
  begin(session: SessionId): {
    beepGate: Promise<void>;
    done: Promise<AmbianceContext>;
  };
  end(session: SessionId, context: AmbianceContext | null): void;
}

/** The custody half of storage (provisional row bookkeeping). */
export interface RecorderCustodyStore {
  open(session: SessionId, audioFile: string): Promise<void>;
  enrich(session: SessionId, fields: { duration: number }): Promise<void>;
}

export interface WavCustodyWriter {
  appendAudio(chunk: Float32Array): Promise<void>;
  finalize(): Promise<void>;
  abort(): Promise<void>;
}

export interface CapturedMicrophone {
  name?: string;
  deviceId?: string;
}

export interface RecorderAdapterDeps {
  sink: LifecycleFactSink;
  tuning: Pick<LifecycleTuning, "deadMicMs" | "drainMs">;
  ambiance: RecorderAmbiance;
  custody: RecorderCustodyStore;
  /** Frames for the transcription stream; bypasses the shell queue. */
  feed: (session: SessionId, chunk: Float32Array) => void;
  audioFilePathFor: (session: SessionId) => string;
  timers?: ShellTimerHost;
  createWavWriter?: (filePath: string) => WavCustodyWriter;
}

export interface RecorderAdapter extends RecorderPort {
  /** Renderer capture handshake (tRPC-reported). */
  captureStarted(session: SessionId, microphone: CapturedMicrophone): void;
  captureStartFailed(session: SessionId, cause: string): void;
  /** Renderer PCM traffic ("audio-data-chunk" IPC). */
  handleAudioChunk(
    session: SessionId,
    chunk: Float32Array,
    isFinalChunk: boolean,
  ): Promise<void>;
  /** Microphone reported for the live session (surface notifications). */
  getActiveMicrophone(): CapturedMicrophone | null;
  /** Resolves once the session's custody has closed and its writer settled
   * (immediately, with an empty outcome, for unknown sessions). The stamp
   * orders behind this — a settled row always has settled custody (D25). */
  whenCustodySettled(session: SessionId): Promise<CustodyOutcome>;
}

/** What custody actually holds once it settles. `wavOk: false` means the
 * writer failed somewhere (append/finalize) — the file must not be
 * advertised by a settled row. A missing row is NOT a custody concern:
 * the storage side repairs that at stamp time. */
export interface CustodyOutcome {
  audioFile: string | null;
  wavOk: boolean;
}

interface CaptureState {
  session: SessionId;
  phase: "starting" | "capturing" | "draining" | "closed";
  beepPending: boolean;
  ambianceContext: AmbianceContext | null;
  ambianceEnded: boolean;
  writer: WavCustodyWriter | null;
  audioFile: string | null;
  /** Writer health: false after any append/finalize failure. */
  wavOk: boolean;
  sawFrames: boolean;
  samples: number;
  microphone: CapturedMicrophone | null;
  deadMicHandle: unknown | null;
  drainHandle: unknown | null;
  closedEmitted: boolean;
  /** Serializes custody writes; chunk IPC callbacks can interleave. */
  writeQueue: Promise<void>;
}

const EMPTY_CUSTODY: CustodyOutcome = { audioFile: null, wavOk: true };

export function createRecorderAdapter(
  deps: RecorderAdapterDeps,
): RecorderAdapter {
  const timers = deps.timers ?? REAL_TIMER_HOST;
  const createWriter =
    deps.createWavWriter ??
    ((filePath: string) => new StreamingWavWriter(filePath));

  /** All open captures, keyed by session (D19): a successor may start while
   * the predecessor is still draining, and the predecessor must keep
   * accepting its in-flight frames until its own custody closes. At most
   * two entries live at once (one draining, one live). */
  const captures = new Map<SessionId, CaptureState>();
  let liveSession: SessionId | null = null;

  /** Custody-settled waiters (R4/D25): resolved when a session's writer
   * closes, carrying what custody holds. */
  const custodySettled = new Map<
    SessionId,
    (outcome: CustodyOutcome) => void
  >();
  const custodySettledPromises = new Map<SessionId, Promise<CustodyOutcome>>();

  function openCustodyWaiter(session: SessionId): void {
    // Settled outcomes stay cached: the stamp usually asks AFTER custody
    // settled (the writer finishes before transcription resolves), and a
    // commit retry can ask again seconds later. Bound the cache instead of
    // deleting on settle.
    while (custodySettledPromises.size > 8) {
      const oldest = custodySettledPromises.keys().next().value;
      if (oldest === undefined) break;
      custodySettledPromises.delete(oldest);
      custodySettled.delete(oldest);
    }
    custodySettledPromises.set(
      session,
      new Promise<CustodyOutcome>((resolve) => {
        custodySettled.set(session, resolve);
      }),
    );
  }

  function settleCustodyWaiter(
    session: SessionId,
    outcome: CustodyOutcome,
  ): void {
    custodySettled.get(session)?.(outcome);
    custodySettled.delete(session);
  }

  function current(session: SessionId): CaptureState | null {
    const capture = captures.get(session);
    return capture && capture.phase !== "closed" ? capture : null;
  }

  function clearTimer(handle: unknown | null): void {
    if (handle !== null) timers.clear(handle);
  }

  function endAmbiance(capture: CaptureState): void {
    if (capture.ambianceEnded) return;
    capture.ambianceEnded = true;
    deps.ambiance.end(capture.session, capture.ambianceContext);
  }

  function closeCustody(capture: CaptureState): void {
    if (capture.phase === "closed") return;
    capture.phase = "closed";
    clearTimer(capture.deadMicHandle);
    clearTimer(capture.drainHandle);
    capture.deadMicHandle = null;
    capture.drainHandle = null;
    endAmbiance(capture);

    const { writer, session, samples } = capture;
    if (writer) {
      capture.writeQueue = capture.writeQueue.then(async () => {
        // wavOk tracks WRITER health only: a failed duration enrichment is
        // a best-effort loss, never a reason to detach a finalized WAV.
        try {
          await writer.finalize();
        } catch (error) {
          capture.wavOk = false;
          logger.audio.error("Failed to finalize audio custody", {
            sessionId: session,
            error,
          });
          return;
        }
        await deps.custody
          .enrich(session, {
            duration: Math.round(samples / SAMPLE_RATE),
          })
          .catch((error) => {
            logger.audio.warn("Failed to enrich custody duration", {
              sessionId: session,
              error,
            });
          });
      });
    }
    void capture.writeQueue.finally(() =>
      settleCustodyWaiter(session, {
        audioFile: capture.audioFile,
        wavOk: capture.wavOk,
      }),
    );
    captures.delete(session);

    if (!capture.closedEmitted) {
      capture.closedEmitted = true;
      deps.sink({ type: "recorderClosed", session });
    }
  }

  return {
    start(session): void {
      openCustodyWaiter(session);
      const capture: CaptureState = {
        session,
        phase: "starting",
        beepPending: true,
        ambianceContext: null,
        ambianceEnded: false,
        writer: null,
        audioFile: null,
        wavOk: true,
        sawFrames: false,
        samples: 0,
        microphone: null,
        deadMicHandle: null,
        drainHandle: null,
        closedEmitted: false,
        writeQueue: Promise.resolve(),
      };
      captures.set(session, capture);
      liveSession = session;
      const { beepGate, done } = deps.ambiance.begin(session);
      void beepGate
        .catch(() => undefined)
        .then(() => {
          capture.beepPending = false;
        });
      void done
        .then((context) => {
          capture.ambianceContext = context;
        })
        .catch((error) => {
          // Ambiance is best-effort (v1: native start failure never blocked
          // capture); frames stop being dropped once the gate settles.
          logger.audio.warn("Recording ambiance failed to begin", {
            sessionId: session,
            error,
          });
        });
    },

    stop(session): void {
      const capture = current(session);
      if (!capture) return;
      if (capture.phase === "starting") {
        // Capture never confirmed; there is nothing to drain.
        closeCustody(capture);
        return;
      }
      if (capture.phase === "draining") return;
      capture.phase = "draining";
      // The dead-mic question is moot once the stop drain begins.
      clearTimer(capture.deadMicHandle);
      capture.deadMicHandle = null;
      endAmbiance(capture);
      capture.drainHandle = timers.set(deps.tuning.drainMs, () => {
        capture.drainHandle = null;
        logger.audio.warn("Recorder drain bound hit; closing with held audio", {
          sessionId: session,
        });
        closeCustody(capture);
      });
    },

    captureStarted(session, microphone): void {
      const capture = current(session);
      if (!capture || capture.phase !== "starting") return;
      capture.phase = "capturing";
      capture.microphone = microphone;
      deps.sink({ type: "recorderReady", session });
      capture.deadMicHandle = timers.set(deps.tuning.deadMicMs, () => {
        capture.deadMicHandle = null;
        if (!capture.sawFrames && capture.phase === "capturing") {
          deps.sink({ type: "noAudioDetected", session });
        }
      });
    },

    captureStartFailed(session, cause): void {
      const capture = current(session);
      if (!capture) return;
      closeCustody(capture);
      deps.sink({ type: "recorderFailed", session, cause });
    },

    async handleAudioChunk(session, chunk, isFinalChunk): Promise<void> {
      const capture = current(session);
      if (!capture) return;

      // Liveness: any delivered frame proves the capture pipeline is alive
      // and defuses the dead-mic bound — including frames dropped below
      // (beep gating, pre-ready arrival). Content is never judged (D18).
      if (chunk.length > 0 && !capture.sawFrames) {
        capture.sawFrames = true;
        clearTimer(capture.deadMicHandle);
        capture.deadMicHandle = null;
      }

      if (capture.phase === "starting") return;

      // Frames captured while the start beep was audible are dropped so the
      // beep is not transcribed; the final chunk always survives so a stop
      // mid-beep still finalizes.
      if (capture.beepPending && !isFinalChunk) return;

      // Draining accepts every in-flight frame (D19): the tail of speech is
      // still arriving through IPC after stop; only custody close drops.

      if (chunk.length > 0) {
        if (!capture.writer) {
          const audioFile = deps.audioFilePathFor(session);
          capture.audioFile = audioFile;
          capture.writer = createWriter(audioFile);
          capture.writeQueue = capture.writeQueue
            .then(() => deps.custody.open(session, audioFile))
            .catch((error) => {
              logger.audio.error("Failed to open audio custody", {
                sessionId: session,
                error,
              });
            });
        }

        const writer = capture.writer;
        capture.samples += chunk.length;
        capture.writeQueue = capture.writeQueue
          .then(() => writer.appendAudio(chunk))
          .catch((error) => {
            capture.wavOk = false;
            logger.audio.error("Failed to append audio custody", {
              sessionId: session,
              error,
            });
          });

        deps.feed(session, chunk);
      }

      if (isFinalChunk) {
        closeCustody(capture);
      }
    },

    getActiveMicrophone(): CapturedMicrophone | null {
      const live = liveSession ? captures.get(liveSession) : null;
      return live && live.phase !== "closed" ? live.microphone : null;
    },

    whenCustodySettled(session: SessionId): Promise<CustodyOutcome> {
      return (
        custodySettledPromises.get(session) ?? Promise.resolve(EMPTY_CUSTODY)
      );
    },
  };
}
