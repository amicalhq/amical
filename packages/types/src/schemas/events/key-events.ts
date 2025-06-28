import { z } from "zod";

// This schema is based on section 7 of rpc.md for unsolicited key events.

export const KeyEventPayloadSchema = z.object({
  key: z.string().optional(), // Made optional as sometimes only code is relevant or available
  code: z.string().optional(), // Made optional as sometimes only key is relevant or available
  altKey: z.boolean().optional(),
  ctrlKey: z.boolean().optional(),
  shiftKey: z.boolean().optional(),
  metaKey: z.boolean().optional(),
  // Adding fields from the existing ipc-schemas.ts for richer event data
  keyCode: z
    .number()
    .int()
    .optional()
    .describe("Raw key code, e.g., from CGEvent"),
  fnKeyPressed: z.boolean().optional().describe("State of the Fn key."),
  // Consider adding raw flags if useful for the client
  // rawFlags: z.number().int().optional().describe("Raw platform-specific event flags"),
});
export type KeyEventPayload = z.infer<typeof KeyEventPayloadSchema>;

export const KeyDownEventSchema = z.object({
  type: z.literal("keyDown"),
  payload: KeyEventPayloadSchema,
  timestamp: z.string().datetime({ offset: true }).optional(), // Using ISO 8601 datetime
});
export type KeyDownEvent = z.infer<typeof KeyDownEventSchema>;

export const KeyUpEventSchema = z.object({
  type: z.literal("keyUp"),
  payload: KeyEventPayloadSchema, // Changed from z.string() to KeyEventPayloadSchema
  timestamp: z.string().datetime({ offset: true }).optional(), // Using ISO 8601 datetime
});
export type KeyUpEvent = z.infer<typeof KeyUpEventSchema>;

export const FlagsChangedEventSchema = z.object({
  type: z.literal("flagsChanged"),
  payload: KeyEventPayloadSchema, // Assuming flags changes also carry similar payload structure
  timestamp: z.string().datetime({ offset: true }).optional(),
});
export type FlagsChangedEvent = z.infer<typeof FlagsChangedEventSchema>;

// This will be the primary schema for unsolicited events from Swift
export const HelperEventSchema = z.discriminatedUnion("type", [
  KeyDownEventSchema,
  KeyUpEventSchema,
  FlagsChangedEventSchema, // Added FlagsChangedEventSchema
  // Future: Add other event types like mouse events, etc.
]);
export type HelperEvent = z.infer<typeof HelperEventSchema>;

// The EventSchema from rpc.md (section 2a) seems more like a generic response wrapper,
// which is different from unsolicited events.
// If a generic status/data event is needed for RPC *responses*, it should be defined
// as a result type for a specific RPC method.
// For now, focusing on unsolicited key events as per section 7.
/*
// src/schemas/helper-responses/event.ts (from rpc.md section 2a)
// This seems like a generic response for a method, not an unsolicited event.
export const EventSchema = z.object({
  status: z.literal("ok").or(z.literal("error")),
  data: z.any(),
});
export type Event = z.infer<typeof EventSchema>;
*/
