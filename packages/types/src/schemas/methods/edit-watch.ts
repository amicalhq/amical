import { z } from "zod";

// =============================================================================
// Edit watch - hold the text element a paste went into and read it on request
// =============================================================================
// The helper keeps one element at a time. It resolves the focused text element
// on startEditWatch, then answers readEditWatch with the element's whole value
// and selection, until stopEditWatch or the next startEditWatch releases it.
// The helper runs no timers and no comparison logic; the desktop decides when
// to read and what the reads mean.
//
// Privacy rule: the text in these results must never be written to a log, by
// the helper or by the desktop. Log only status, text length and timing.
// =============================================================================

export const EDIT_WATCH_LIMITS = {
  /** Longest value (UTF-16 code units) a read returns; longer answers `too_long`. */
  maxTextLength: 8000,
} as const;

export const EditWatchStartStatusSchema = z.enum([
  "ok",
  "no_permission",
  "no_element",
  "secure",
  "no_value",
  "too_long",
]);
export type EditWatchStartStatus = z.infer<typeof EditWatchStartStatusSchema>;

export const EditWatchReadStatusSchema = z.enum([
  "ok",
  "gone",
  "unknown_watch",
  "too_long",
  "error",
]);
export type EditWatchReadStatus = z.infer<typeof EditWatchReadStatusSchema>;

// startEditWatch -------------------------------------------------------------

export const StartEditWatchParamsSchema = z.object({});
export type StartEditWatchParams = z.infer<typeof StartEditWatchParamsSchema>;

export const StartEditWatchResultSchema = z.object({
  /** Id of the held element; null when startStatus is not "ok". */
  watchId: z.string().nullable().default(null),
  startStatus: EditWatchStartStatusSchema,
});
export type StartEditWatchResult = z.infer<typeof StartEditWatchResultSchema>;

// readEditWatch --------------------------------------------------------------

export const ReadEditWatchParamsSchema = z.object({
  watchId: z.string(),
});
export type ReadEditWatchParams = z.infer<typeof ReadEditWatchParamsSchema>;

export const EditWatchSelectionSchema = z.object({
  /** UTF-16 code units, in the same coordinate space as `text`. */
  location: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
});
export type EditWatchSelection = z.infer<typeof EditWatchSelectionSchema>;

export const ReadEditWatchResultSchema = z.object({
  readStatus: EditWatchReadStatusSchema,
  /** Whole value of the held element; null unless readStatus is "ok". */
  text: z.string().nullable().default(null),
  /** Caret or selection; null when the element exposes none. */
  selection: EditWatchSelectionSchema.nullable().default(null),
  /** Time the helper spent on this read, in milliseconds. */
  readMs: z.number().nonnegative(),
});
export type ReadEditWatchResult = z.infer<typeof ReadEditWatchResultSchema>;

// stopEditWatch --------------------------------------------------------------

export const StopEditWatchParamsSchema = z.object({
  watchId: z.string(),
});
export type StopEditWatchParams = z.infer<typeof StopEditWatchParamsSchema>;

export const StopEditWatchResultSchema = z.object({
  /** False when the id was not the current watch (already replaced). */
  stopped: z.boolean(),
});
export type StopEditWatchResult = z.infer<typeof StopEditWatchResultSchema>;
