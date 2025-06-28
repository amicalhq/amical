/**
 * Pipeline module exports
 */

// Core types
export type {
  TranscriptionProvider,
  FormattingProvider,
  PipelineResult,
  PipelineConfig,
  StreamingPipelineContext,
  StreamingSession,
} from "./core/pipeline-types";

// Context management
export { createDefaultContext } from "./core/context";
export type { PipelineContext, SharedPipelineData } from "./core/context";

// Main service
export { TranscriptionService } from "../services/transcription-service";

// Providers (if needed externally)
export { WhisperProvider } from "./providers/transcription/whisper-provider";
export { OpenRouterProvider } from "./providers/formatting/openrouter-formatter";
