import { z } from "zod";

// Schema for recheckPressedKeys RPC method
// Used to reconcile Electron's pressed key state against OS truth

export const RecheckPressedKeysParamsSchema = z.object({
  pressedKeyCodes: z.array(z.number().int()),
});
export type RecheckPressedKeysParams = z.infer<
  typeof RecheckPressedKeysParamsSchema
>;

export const RecheckPressedKeysResultSchema = z.object({
  staleKeyCodes: z.array(z.number().int()),
});
export type RecheckPressedKeysResult = z.infer<
  typeof RecheckPressedKeysResultSchema
>;
