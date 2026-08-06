/**
 * Core pipeline types - Simple interfaces without over-engineering
 */

import { GetAccessibilityContextResult } from "@amical/types";

// Context for transcription operations (shared between transcribe and flush)
export interface TranscribeContext {
  sessionId?: string;
  vocabulary?: string[];
  accessibilityContext?: GetAccessibilityContextResult | null;
  previousChunk?: string;
  aggregatedTranscription?: string;
  languages?: string[]; // Selected dictation languages; providers consume this
  formattingEnabled?: boolean;
  // When true the session sends the "instruct" preset (cloud generates content
  // from the spoken instruction instead of formatting the transcript).
  isInstruct?: boolean;
}

// Transcription input parameters
export interface TranscribeParams {
  audioData: Float32Array;
  speechProbability?: number; // Speech probability from frontend VAD (0-1)
  context: TranscribeContext;
}

export interface TranscriptionOutput {
  text: string;
  detectedLanguage?: string;
}

export interface OpenTranscriptionSessionOptions {
  sessionId: string;
  /**
   * Model selected for this operation. Local engines use it to keep the
   * session on that model even if the application selection changes later.
   */
  modelId?: string | null;
  /** Reports an out-of-band failure after session-local recovery is exhausted. */
  onTerminalFailure?: (error: Error) => void;
}

/**
 * Mutable state for exactly one transcription operation.
 *
 * Engines own reusable resources such as the Whisper worker and loaded
 * model. Sessions own operation state such as audio buffers and cancellation,
 * so one operation cannot reset another.
 */
export interface TranscriptionProviderSession {
  readonly name: string;
  readonly sessionId: string;
  transcribe(params: TranscribeParams): Promise<TranscriptionOutput>;
  flush(
    context: TranscribeContext,
    signal?: AbortSignal,
  ): Promise<TranscriptionOutput>;
  /** Push a newer context snapshot to an already-open streaming transport. */
  updateSessionContext?(context: TranscribeContext): Promise<void>;
  /**
   * Permanently close this operation. Implementations must make cancellation
   * idempotent and no-throw; callers open a new session for later work.
   */
  cancel(): void;
}

// Formatting input parameters
export interface FormatParams {
  text: string;
  context: {
    style?: string;
    vocabulary?: string[];
    accessibilityContext?: GetAccessibilityContextResult | null;
    previousChunk?: string;
    aggregatedTranscription?: string;
  };
}

export interface TranscriptionEngine {
  readonly name: string;
  openSession(
    options: OpenTranscriptionSessionOptions,
  ): TranscriptionProviderSession;
  /**
   * Prepare the engine for upcoming work. Called at app boot and on each
   * recording start. Must be idempotent and cheap when already warm.
   *
   * Local engines: load model weights into memory if not already loaded.
   * Cloud engines: refresh auth tokens if expiring (do NOT open transport
   * connections — those should stay lazy on first chunk so cancelled-before-
   * first-chunk sessions don't waste a connection).
   */
  warmup?(): Promise<void>;
  dispose(): Promise<void>;
}

// Formatting provider interface
export interface FormattingProvider {
  readonly name: string;
  format(params: FormatParams): Promise<string>;
}
