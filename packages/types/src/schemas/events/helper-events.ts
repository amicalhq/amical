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
  keyCode: z.number().int().describe("Raw key code, e.g., from CGEvent"),
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

// Unsolicited notification fired (Windows helper) when the foreground window
// moves to a different monitor. Like macOS's NSWorkspaceActiveDisplayDidChange
// it carries no payload — it's just a trigger, and the desktop side reads the
// cursor position to pick the display to relocate the widget to.
export const ActiveDisplayChangedEventSchema = z.object({
  type: z.literal("activeDisplayChanged"),
  timestamp: z.string().datetime({ offset: true }).optional(),
});
export type ActiveDisplayChangedEvent = z.infer<
  typeof ActiveDisplayChangedEventSchema
>;

// Chord-level shortcut events. Only the Linux helper sends them, and only in
// chord mode (a compositor portal binds the shortcuts). A helper never sends
// these and keyDown/keyUp in the same mode.
// - One shortcutActivated per physical press: the helper drops key repeats.
// - Every release that the backend reports becomes a shortcutDeactivated.
//   The helper never invents one.
export const ShortcutEdgePayloadSchema = z.object({
  /** Descriptor id from setShortcuts. */
  id: z.string(),
});
export type ShortcutEdgePayload = z.infer<typeof ShortcutEdgePayloadSchema>;

export const ShortcutActivatedEventSchema = z.object({
  type: z.literal("shortcutActivated"),
  payload: ShortcutEdgePayloadSchema,
  timestamp: z.string().datetime({ offset: true }).optional(),
});
export type ShortcutActivatedEvent = z.infer<
  typeof ShortcutActivatedEventSchema
>;

export const ShortcutDeactivatedEventSchema = z.object({
  type: z.literal("shortcutDeactivated"),
  payload: ShortcutEdgePayloadSchema,
  timestamp: z.string().datetime({ offset: true }).optional(),
});
export type ShortcutDeactivatedEvent = z.infer<
  typeof ShortcutDeactivatedEventSchema
>;

export const ShortcutBindFailureReasonSchema = z.enum([
  "unsupported-shape",
  "denied",
  "dismissed",
  "hyprland-manual-bind",
  "no-backend",
  "portal-unavailable",
  "backend-error",
]);
export type ShortcutBindFailureReason = z.infer<
  typeof ShortcutBindFailureReasonSchema
>;

// The current binding state. The helper sends it after each bind, after each
// rebind in system settings, and after it binds again when the portal
// restarts. Each one replaces the previous state.
export const ShortcutsBoundEventSchema = z.object({
  type: z.literal("shortcutsBound"),
  payload: z.object({
    bound: z.array(
      z.object({
        id: z.string(),
        /** Trigger text that the compositor shows; null when it reports none. */
        trigger: z.string().nullable().default(null),
        /** This chord's shape gets a reliable release from the backend. */
        holdReliable: z.boolean(),
      }),
    ),
    failed: z.array(
      z.object({
        id: z.string(),
        reason: ShortcutBindFailureReasonSchema,
        message: z.string().optional(),
      }),
    ),
    /** True while the compositor's bind dialog is open. */
    pending: z.boolean(),
  }),
  timestamp: z.string().datetime({ offset: true }).optional(),
});
export type ShortcutsBoundEvent = z.infer<typeof ShortcutsBoundEventSchema>;

// Events that the macOS and Windows helpers send. The Swift and C# models are
// generated from this union, so Linux-only events stay out of it.
export const MacWindowsHelperEventSchema = z.discriminatedUnion("type", [
  KeyDownEventSchema,
  KeyUpEventSchema,
  FlagsChangedEventSchema,
  ActiveDisplayChangedEventSchema,
]);

// Every event that the desktop accepts from a helper.
export const HelperEventSchema = z.discriminatedUnion("type", [
  ...MacWindowsHelperEventSchema.options,
  ShortcutActivatedEventSchema,
  ShortcutDeactivatedEventSchema,
  ShortcutsBoundEventSchema,
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
