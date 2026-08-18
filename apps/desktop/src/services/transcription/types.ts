import type { GetAccessibilityContextResult } from "@amical/types";
import type { TranscriptionProviderSession } from "../../pipeline/core/pipeline-types";

export interface DictationContext {
  sessionId: string;
  vocabulary: string[];
  replacements: Map<string, string>;
  languages?: string[];
  formattingStyle: "formal" | "casual" | "technical";
  audio: {
    source: "microphone" | "file" | "stream";
    duration?: number;
  };
  accessibilityContext: GetAccessibilityContextResult | null;
  cloudFormattingEnabled: boolean;
  isInstruct: boolean;
}

export interface StreamingSessionUpdate {
  accessibilityContext?: GetAccessibilityContextResult | null;
  isInstruct?: boolean;
}

export interface MaterializedTranscriptionSession {
  context: DictationContext;
  providerSession: TranscriptionProviderSession;
  speechModelId: string;
  transcriptionResults: string[];
  detectedLanguage?: string;
  firstChunkReceivedAt?: number;
  finalizationStartedAt?: number;
}
