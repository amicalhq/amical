import { isCloudError, type CloudError } from "./cloud";
import { isLocalWhisperError, type LocalWhisperError } from "./whisper";
import { DependencyFailure, ServiceInitFailed } from "./service";

/** The union the service and session error channels carry. */
export type DictationError =
  | CloudError
  | LocalWhisperError
  | DependencyFailure
  | ServiceInitFailed;

export const isDictationError = (error: unknown): error is DictationError =>
  isCloudError(error) ||
  isLocalWhisperError(error) ||
  error instanceof DependencyFailure ||
  error instanceof ServiceInitFailed;
