import { Data } from "effect";

/** No local model selected or the selected one is not on disk. */
export class ModelMissing extends Data.TaggedError("ModelMissing")<{
  message: string;
  modelId?: string;
}> {}

/** The worker process or model failed to initialize. */
export class WorkerInitFailed extends Data.TaggedError("WorkerInitFailed")<{
  message: string;
  cause: unknown;
}> {}

/** The worker process errored or exited with calls in flight. */
export class WorkerCrashed extends Data.TaggedError("WorkerCrashed")<{
  message: string;
  cause?: unknown;
  exitCode?: number | null;
  signal?: string | null;
}> {}

/** A decode failed inside the worker or its result never arrived. */
export class LocalTranscriptionFailed extends Data.TaggedError(
  "LocalTranscriptionFailed",
)<{
  message: string;
  cause: unknown;
}> {}

/** The OS cannot run the bundled bindings. */
export class LocalTranscriptionUnsupported extends Data.TaggedError(
  "LocalTranscriptionUnsupported",
)<{
  message: string;
}> {}

/** The whisper engine was disposed while a session still raced it. */
export class EngineDisposed extends Data.TaggedError("EngineDisposed")<{
  message: string;
}> {}

export type LocalWhisperError =
  | ModelMissing
  | WorkerInitFailed
  | WorkerCrashed
  | LocalTranscriptionFailed
  | LocalTranscriptionUnsupported
  | EngineDisposed;

export const isLocalWhisperError = (
  error: unknown,
): error is LocalWhisperError =>
  error instanceof ModelMissing ||
  error instanceof WorkerInitFailed ||
  error instanceof WorkerCrashed ||
  error instanceof LocalTranscriptionFailed ||
  error instanceof LocalTranscriptionUnsupported ||
  error instanceof EngineDisposed;
