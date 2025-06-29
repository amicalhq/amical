/**
 * Simple context management for the pipeline - no over-engineering
 * Based on ARCHITECTURE.md specifications
 */

export interface PipelineContext {
  sessionId: string;
  sharedData: SharedPipelineData;
  metadata: Map<string, any>;
}

import { GetAccessibilityContextResult } from "@amical/types";

export interface SharedPipelineData {
  vocabulary: Map<string, string>;
  userPreferences: {
    language: string;
    formattingStyle: "formal" | "casual" | "technical";
  };
  audioMetadata: {
    source: "microphone" | "file" | "stream";
    duration?: number;
  };
  accessibilityContext: GetAccessibilityContextResult | null;
}

/**
 * Create a default context for pipeline execution
 */
export function createDefaultContext(sessionId: string): PipelineContext {
  return {
    sessionId,
    sharedData: {
      vocabulary: new Map(),
      userPreferences: {
        language: "en",
        formattingStyle: "formal",
      },
      audioMetadata: {
        source: "microphone",
      },
      accessibilityContext: null, // Will be populated async by TranscriptionService
    },
    metadata: new Map(),
  };
}
