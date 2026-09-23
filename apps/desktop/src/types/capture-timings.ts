import { z } from "zod";

export const CapturePhaseNameSchema = z.enum([
  "capture.enumerate-devices",
  "capture.get-user-media",
  "capture.audio-context-create",
  "capture.audio-context-resume",
  "capture.first-frame-wait",
]);

export type CapturePhaseName = z.infer<typeof CapturePhaseNameSchema>;

export const CaptureTimingsSchema = z.object({
  phases: z
    .array(
      z.object({
        name: CapturePhaseNameSchema,
        startedAtMs: z.number().finite().nonnegative(),
        durationMs: z.number().finite().nonnegative(),
      }),
    )
    .max(CapturePhaseNameSchema.options.length),
});

export type CaptureTimingsBatch = z.infer<typeof CaptureTimingsSchema>;
