export type RecordingState = "idle" | "starting" | "recording" | "stopping";

export type RecordingMode = "ptt" | "hands-free";

export interface CaptureFailure {
  sessionId: string;
  name?: string;
  message: string;
}
