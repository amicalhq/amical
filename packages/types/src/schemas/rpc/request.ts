import { z } from "zod";
import { GetAccessibilityTreeDetailsParamsSchema } from "../methods/get-accessibility-tree-details.js";
import { GetAccessibilityContextParamsSchema } from "../methods/get-accessibility-context.js";
import { PasteTextParamsSchema } from "../methods/paste-text.js";

// Define a union of all possible RPC method names
const RPCMethodNameSchema = z.union([
  z.literal("getAccessibilityTreeDetails"),
  z.literal("getAccessibilityContext"),
  z.literal("getAccessibilityStatus"),
  z.literal("requestAccessibilityPermission"),
  z.literal("pasteText"),
  z.literal("muteSystemAudio"),
  z.literal("restoreSystemAudio"),
  z.literal("setShortcuts"),
]);

export const RpcRequestSchema = z.object({
  id: z.string().uuid(), // Changed to uuid for stricter validation
  method: RPCMethodNameSchema,
  // Using z.any() for params. The Swift side will handle decoding based on the method.
  // Type safety on the TypeScript side for params is handled by the RPCMethods interface in swift-rpc-client.ts.
  params: z.any().optional(),
});

export type RpcRequest = z.infer<typeof RpcRequestSchema>;

// --- Specific Request Schemas (Optional but good for clarity and potential future use) ---

export const GetAccessibilityTreeDetailsRequestSchema = RpcRequestSchema.extend(
  {
    method: z.literal("getAccessibilityTreeDetails"),
    params: GetAccessibilityTreeDetailsParamsSchema.optional(),
  },
);
export type GetAccessibilityTreeDetailsRequest = z.infer<
  typeof GetAccessibilityTreeDetailsRequestSchema
>;

export const GetAccessibilityContextRequestSchema = RpcRequestSchema.extend({
  method: z.literal("getAccessibilityContext"),
  params: GetAccessibilityContextParamsSchema.optional(),
});
export type GetAccessibilityContextRequest = z.infer<
  typeof GetAccessibilityContextRequestSchema
>;

export const PasteTextRequestSchema = RpcRequestSchema.extend({
  method: z.literal("pasteText"),
  params: PasteTextParamsSchema, // Assuming pasteText always requires params
});
export type PasteTextRequest = z.infer<typeof PasteTextRequestSchema>;

export const PlaySystemAudioRequestSchema = RpcRequestSchema.extend({
  method: z.literal("playSystemAudio"),
  params: z.null(),
});
export type PlaySystemAudioRequest = z.infer<
  typeof PlaySystemAudioRequestSchema
>;

export const PauseSystemAudioRequestSchema = RpcRequestSchema.extend({
  method: z.literal("pauseSystemAudio"),
  params: z.null(),
});
export type PauseSystemAudioRequest = z.infer<
  typeof PauseSystemAudioRequestSchema
>;

// Example for another method if you had one:
/*
export const SetLogLevelParamsSchema = z.object({ level: z.string() });
export const SetLogLevelRequestSchema = RpcRequestSchema.extend({
  method: z.literal('setLogLevel'),
  params: SetLogLevelParamsSchema,
});
export type SetLogLevelRequest = z.infer<typeof SetLogLevelRequestSchema>;
*/
