import { z } from "zod";

// Schema for setDraftEnterCapture RPC method.
//
// While a Draft review window is open, the desktop arms the native helper to
// consume the Enter key (so it doesn't reach the focused app); the desktop
// triggers Insert on the forwarded Enter key-down. The native mask is
// SELF-DISARMING: it consumes the Enter key-down (and repeats) while armed and
// disarms itself on the Enter key-up. So a missed/dropped disarm can swallow at
// most one Enter press — the mask can never become permanent.
export const SetDraftEnterCaptureParamsSchema = z.object({
  enabled: z.boolean(),
});
export type SetDraftEnterCaptureParams = z.infer<
  typeof SetDraftEnterCaptureParamsSchema
>;

export const SetDraftEnterCaptureResultSchema = z.object({
  success: z.boolean(),
});
export type SetDraftEnterCaptureResult = z.infer<
  typeof SetDraftEnterCaptureResultSchema
>;
