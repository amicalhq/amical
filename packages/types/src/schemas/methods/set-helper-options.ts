import { z } from "zod";
import { GetHelperCapabilitiesResultSchema } from "./get-helper-capabilities.js";

// setHelperOptions - Linux only. The desktop keeps the user's choices in its
// settings and sends them after the capability probe, before setShortcuts.
// The result carries fresh capabilities, so the desktop does not probe again.

export const SetHelperOptionsParamsSchema = z.object({
  /** Read keys from evdev devices. Explicit opt-in only. */
  evdevKeyInput: z.boolean().optional(),
});
export type SetHelperOptionsParams = z.infer<
  typeof SetHelperOptionsParamsSchema
>;

export const SetHelperOptionsResultSchema = z.object({
  success: z.boolean(),
  capabilities: GetHelperCapabilitiesResultSchema,
});
export type SetHelperOptionsResult = z.infer<
  typeof SetHelperOptionsResultSchema
>;
