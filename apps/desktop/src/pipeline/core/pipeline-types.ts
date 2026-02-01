/**
 * Core pipeline types - Simple interfaces without over-engineering
 */

// Re-export context types from dedicated file
import { PipelineContext } from "./context";
import { GetAccessibilityContextResult } from "@amical/types";
export { PipelineContext, SharedPipelineData } from "./context";

// Context for transcription operations (shared between transcribe and flush)
export interface TranscribeContext {
  sessionId?: string;
  vocabulary?: string[];
  accessibilityContext?: GetAccessibilityContextResult | null;
  previousChunk?: string;
  aggregatedTranscription?: string;
  language?: string;
  formattingEnabled?: boolean;
}

// Transcription input parameters
export interface TranscribeParams {
  audioData: Float32Array;
  speechProbability?: number; // Speech probability from frontend VAD (0-1)
  context: TranscribeContext;
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
    customInstructions?: string;
  };
}

// Transcription provider interface
export interface TranscriptionProvider {
  readonly name: string;
  transcribe(params: TranscribeParams): Promise<string>;
  flush(context: TranscribeContext): Promise<string>;
  reset(): void; // Clear internal buffers without transcribing
}

// Formatting provider interface
export interface FormattingProvider {
  readonly name: string;
  format(params: FormatParams): Promise<string>;
}

// Pipeline execution result
export interface PipelineResult {
  transcription: string;
  sessionId: string;
  metadata: {
    duration?: number;
    provider: string;
    formatted: boolean;
  };
}

// Streaming context for pipeline processing
export interface StreamingPipelineContext extends PipelineContext {
  sessionId: string;
  isPartial: boolean;
  isFinal: boolean;
  accumulatedTranscription?: string[]; // Store all partial results
}

// Session data for streaming transcription
export interface StreamingSession {
  context: StreamingPipelineContext;
  transcriptionResults: string[]; // Accumulate all transcription chunks
  firstChunkReceivedAt?: number; // When first audio chunk arrived at transcription service
  recordingStartedAt?: number; // When user pressed record button (from RecordingManager)
  recordingStoppedAt?: number; // When user released record button (from RecordingManager)
  finalizationStartedAt?: number; // When finalizeSession() was called
}

// Simple pipeline configuration
export interface PipelineConfig {
  transcriptionProvider: TranscriptionProvider;
  formattingProvider?: FormattingProvider;
  saveToDatabase: boolean;
}
