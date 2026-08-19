import { Data } from "effect";

/**
 * An EXPECTED failure of a foreign dependency at a designated wrap-policy
 * lift (settings DB, context loaders). Genuinely unexpected conditions die
 * instead — a value in the typed channel always names an expected category.
 */
export class DependencyFailure extends Data.TaggedError("DependencyFailure")<{
  message: string;
  cause: unknown;
}> {}

/**
 * The transcription service failed to initialize at boot; sessions fail at
 * open. Cause-less by design: the original boot failure predates any worker
 * and is gone by the time the degraded stub throws.
 */
export class ServiceInitFailed extends Data.TaggedError("ServiceInitFailed")<{
  message: string;
}> {}
