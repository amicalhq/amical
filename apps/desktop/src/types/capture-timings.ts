import { z } from "zod";

export const CapturePhaseNameSchema = z.enum([
  "capture.enumerate-devices",
  "capture.get-user-media",
  "capture.audio-context-create",
  "capture.audio-context-resume",
  "capture.first-frame-wait",
]);

export type CapturePhaseName = z.infer<typeof CapturePhaseNameSchema>;

export const AudioContextOperationSchema = z.enum([
  "create",
  "worklet-load",
  "graph-setup",
  "resume",
  "recover",
  "unexpected-close",
]);

export type AudioContextOperation = z.infer<typeof AudioContextOperationSchema>;

export const AudioContextTelemetrySchema = z.object({
  recoveryAttemptCount: z.number().int().nonnegative(),
  recoverySuccessCount: z.number().int().nonnegative(),
  recoveryFailureCount: z.number().int().nonnegative(),
  recoveryDurationMs: z.number().finite().nonnegative(),
  failureOperation: AudioContextOperationSchema.optional(),
  failureState: z.string().optional(),
});

export type AudioContextTelemetry = z.infer<typeof AudioContextTelemetrySchema>;

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
  audioContext: AudioContextTelemetrySchema.optional(),
});

export type CaptureTimingsBatch = z.infer<typeof CaptureTimingsSchema>;
