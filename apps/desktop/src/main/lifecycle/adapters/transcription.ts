import { Effect } from "effect";
import { logger } from "../../logger";
import { AppError, ErrorCodes } from "../../../types/error";
import type { ResolvedStreamingSession } from "../../../services/transcription-service";
import { type SessionWork } from "../effect/session-work";
import type { LifecycleFactSink, TranscriptionPort } from "../ports";
import type { SessionId } from "../types";

/**
 * TranscriptionPort — drives the streaming transcription service for the
 * lifecycle.
 *
 * The stream opens at session start and is fed frames by the RecorderPort
 * (bypassing the shell queue). The shell only ever commands the ending:
 * finalize resolves the stream into a transcriptionFinal fact (a session
 * that was never fed synthesizes empty), cancel abandons it silently. An
 * uncommanded terminal provider failure surfaces as transcriptionFinal
 * failure wherever the machine happens to be — the uniform seal law decides
 * what it means.
 */

/** The slice of TranscriptionService the lifecycle drives. */
export interface StreamingTranscriptionService {
  beginStreamingSession(
    sessionId: string,
    onTerminalFailure?: (error: Error) => void,
  ): boolean;
  processStreamingChunk(options: {
    sessionId: string;
    audioChunk: Float32Array;
    isInstruct?: boolean;
  }): Promise<string>;
  resolveStreamingSession(options: {
    sessionId: string;
  }): Promise<ResolvedStreamingSession | null>;
  cancelStreamingSession(sessionId: string): Promise<void>;
  resetVadForNewSession(): Promise<void>;
  warmupActiveProvider(): Promise<void>;
}

export interface TranscriptionEnrichment {
  language?: string | null;
  detectedLanguage?: string | null;
  speechModel?: string | null;
  formattingModel?: string | null;
  metaPatch?: Record<string, unknown>;
}

export interface TranscriptionFailureDetail {
  uiTitle?: string;
  uiMessage?: string;
  traceId?: string;
}

export interface TranscriptionAdapterDeps {
  sink: LifecycleFactSink;
  sessionWork: SessionWork;
  service: StreamingTranscriptionService;
  /** Descriptive fields onto the custody row (never the fate). Awaited
   * before the final fact so the disposition stamp — which rewrites meta —
   * can never interleave with this write and lose fields. */
  enrich: (
    session: SessionId,
    fields: TranscriptionEnrichment,
  ) => Promise<void> | void;
  /** Rich toast fields for a failure cause; outside the contract. */
  onFailureDetail?: (
    session: SessionId,
    detail: TranscriptionFailureDetail,
  ) => void;
}

export interface TranscriptionAdapter extends TranscriptionPort {
  /** Open the stream for a freshly started session. */
  open(session: SessionId): void;
  /** RecorderPort frame traffic; bypasses the shell queue. */
  feed(session: SessionId, chunk: Float32Array): void;
  /** Draft latch: subsequent frames carry the instruct flag. */
  setDraft(session: SessionId, isDraft: boolean): void;
}

interface SttSession {
  session: SessionId;
  isDraft: boolean;
  cancelled: boolean;
  finalEmitted: boolean;
}

function causeOf(error: unknown): string {
  return error instanceof AppError ? error.errorCode : ErrorCodes.UNKNOWN;
}

function detailOf(error: unknown): TranscriptionFailureDetail | null {
  if (!(error instanceof AppError)) return null;
  if (!error.uiTitle && !error.uiMessage && !error.traceId) return null;
  return {
    uiTitle: error.uiTitle,
    uiMessage: error.uiMessage,
    traceId: error.traceId,
  };
}

export function createTranscriptionAdapter(
  deps: TranscriptionAdapterDeps,
): TranscriptionAdapter {
  let state: SttSession | null = null;
  /** Never-opened sessions whose finalize already synthesized empty —
   * finalize must be idempotent (§6.1). */
  let lastSynthesizedEmpty: SessionId | null = null;

  function current(session: SessionId): SttSession | null {
    return state && state.session === session ? state : null;
  }

  function emitFinal(
    stt: SttSession,
    result:
      | { kind: "text"; text: string }
      | { kind: "empty" }
      | { kind: "failure"; cause: string },
  ): void {
    if (stt.cancelled || stt.finalEmitted) return;
    stt.finalEmitted = true;
    deps.sink({ type: "transcriptionFinal", session: stt.session, result });
  }

  return {
    open(session): void {
      const stt: SttSession = {
        session,
        isDraft: false,
        cancelled: false,
        finalEmitted: false,
      };
      state = stt;
      try {
        const accepted = deps.service.beginStreamingSession(
          session,
          (error) => {
            const detail = detailOf(error);
            if (detail) deps.onFailureDetail?.(session, detail);
            emitFinal(stt, { kind: "failure", cause: causeOf(error) });
          },
        );
        if (!accepted) {
          // The service refused the stream (a stale session still holds
          // it). The session cannot transcribe; fail it now rather than
          // letting finalize synthesize a misleading empty later.
          logger.transcription.error("Streaming session refused", {
            sessionId: session,
          });
          emitFinal(stt, { kind: "failure", cause: ErrorCodes.UNKNOWN });
          return;
        }
      } catch (error) {
        // A stale stream is still registered (should be impossible under the
        // serialized lifecycle); surface it as this session's failure.
        logger.transcription.error("Failed to open streaming session", {
          sessionId: session,
          error,
        });
        emitFinal(stt, { kind: "failure", cause: causeOf(error) });
        return;
      }
      // The VAD reset runs as session work: a session already retired at
      // dispatch time is refused. A reset ALREADY dispatched cannot be
      // recalled if it lands late (the cloud-call limit, plan E1 pin 11) —
      // this fences the dispatch, not the resolution. Warmup stays
      // app-level fire-and-forget — provider state, not session state.
      deps.sessionWork.forkDelivery(
        session,
        Effect.tryPromise({
          try: () => deps.service.resetVadForNewSession(),
          catch: (error) => error,
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() =>
              logger.transcription.warn("VAD reset failed", { error }),
            ),
          ),
        ),
      );
      void deps.service.warmupActiveProvider().catch((error) => {
        logger.transcription.warn("Provider warmup failed (non-fatal)", {
          error,
        });
      });
    },

    feed(session, chunk): void {
      const stt = current(session);
      if (!stt || stt.cancelled || stt.finalEmitted) return;
      void deps.service
        .processStreamingChunk({
          sessionId: session,
          audioChunk: chunk,
          isInstruct: stt.isDraft,
        })
        .catch((error) => {
          logger.transcription.error("Streaming chunk failed", {
            sessionId: session,
            error,
          });
        });
    },

    setDraft(session, isDraft): void {
      const stt = current(session);
      if (stt) stt.isDraft = isDraft;
    },

    finalize(session): void {
      const stt = current(session);
      if (!stt) {
        // Never opened: nothing was ever fed, so the result is empty —
        // synthesized exactly once per session (finalize is idempotent).
        if (lastSynthesizedEmpty === session) return;
        lastSynthesizedEmpty = session;
        deps.sink({
          type: "transcriptionFinal",
          session,
          result: { kind: "empty" },
        });
        return;
      }
      // The resolve chain is an obligation: it must run to completion after
      // the session leaves RESOLVING (the seal consumes its result wherever
      // the machine is — uniform seal law). The terminal fact is guarded by
      // the emitFinal once-latch, NOT an exit-filtered fact: three producers
      // share it (this chain, the out-of-band terminal-failure callback,
      // cancel), and the callback producer is no fiber exit — the flags are
      // the only mechanism covering all three (audit S3).
      deps.sessionWork.runObligation(
        session,
        Effect.promise(async () => {
          try {
            const resolved = await deps.service.resolveStreamingSession({
              sessionId: session,
            });
            if (resolved) {
              await deps.enrich(session, {
                language: resolved.language ?? null,
                detectedLanguage: resolved.detectedLanguage ?? null,
                speechModel: resolved.speechModel ?? null,
                formattingModel: resolved.formattingModel ?? null,
                metaPatch: resolved.meta,
              });
            }
            if (!resolved || resolved.text.trim() === "") {
              emitFinal(stt, { kind: "empty" });
            } else {
              emitFinal(stt, { kind: "text", text: resolved.text });
            }
          } catch (error) {
            if (!stt.cancelled && !stt.finalEmitted) {
              logger.transcription.error(
                "Failed to resolve streaming session",
                {
                  sessionId: session,
                  error,
                },
              );
              const detail = detailOf(error);
              if (detail) deps.onFailureDetail?.(session, detail);
            }
            emitFinal(stt, { kind: "failure", cause: causeOf(error) });
          }
        }),
      );
    },

    cancel(session): void {
      const stt = current(session);
      if (!stt || stt.cancelled) return;
      stt.cancelled = true;
      void deps.service.cancelStreamingSession(session).catch((error) => {
        logger.transcription.warn("Failed to cancel streaming session", {
          sessionId: session,
          error,
        });
      });
    },
  };
}
