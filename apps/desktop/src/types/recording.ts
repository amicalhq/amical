export type RecordingState = "idle" | "starting" | "recording" | "stopping";

export interface CaptureStartFailure {
  sessionId: string;
  name?: string;
  message: string;
}
