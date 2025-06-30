export type RecordingState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "error";

export interface RecordingStatus {
  state: RecordingState;
  sessionId: string | null;
  error?: string;
}
