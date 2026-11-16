import { z } from "zod";

// prepareInjection - Linux only. Asks for the consent that the injection
// backend needs now, so that onboarding shows the system dialog instead of
// the first dictation. A helper that never receives it asks at first paste.

export const PrepareInjectionParamsSchema = z.object({});
export type PrepareInjectionParams = z.infer<
  typeof PrepareInjectionParamsSchema
>;

export const PrepareInjectionResultSchema = z.object({
  ready: z.boolean(),
  message: z.string().optional(),
});
export type PrepareInjectionResult = z.infer<
  typeof PrepareInjectionResultSchema
>;
