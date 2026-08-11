export type RecordingState = "idle" | "starting" | "recording" | "stopping";

export type RecordingMode = "ptt" | "hands-free";

export interface CaptureStartFailure {
  sessionId: string;
  name?: string;
  message: string;
}
