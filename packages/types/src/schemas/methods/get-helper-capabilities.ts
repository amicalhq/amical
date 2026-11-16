import { z } from "zod";

// =============================================================================
// getHelperCapabilities - what the Linux helper can do in this session
// =============================================================================
// Only the Linux helper implements this method. The desktop calls it first
// after every "ready" on Linux and drives shortcuts, paste and onboarding from
// the answer. The macOS and Windows helpers have a fixed feature set and never
// receive it.
// =============================================================================

export const GetHelperCapabilitiesParamsSchema = z.object({
  /** Desktop-file id. The helper registers it with the portal host registry before any portal call. */
  appId: z.string().optional(),
});
export type GetHelperCapabilitiesParams = z.infer<
  typeof GetHelperCapabilitiesParamsSchema
>;

/**
 * per-key: keyDown/keyUp events, like macOS and Windows.
 * chord:   shortcutActivated/shortcutDeactivated events for bound shortcuts only.
 * none:    no shortcut input. The widget starts and stops dictation.
 */
export const KeyInputModeSchema = z.enum(["per-key", "chord", "none"]);
export type KeyInputMode = z.infer<typeof KeyInputModeSchema>;

export const KeyInputBackendSchema = z.enum([
  "xi2",
  "xi2-xwayland",
  "evdev",
  "portal-global-shortcuts",
]);
export type KeyInputBackend = z.infer<typeof KeyInputBackendSchema>;

/**
 * Chord shapes for which the backend reports a reliable release:
 * any:                 every shape (per-key backends).
 * unmodified-key-only: a chord without modifiers. The release is lost when a modifier is lifted first.
 * modifier-plus-key:   a modifier chord. The release also comes on any key-up.
 * tap-only:            no reliable release. Hold bindings run as tap-toggle.
 */
export const HoldSupportSchema = z.enum([
  "any",
  "unmodified-key-only",
  "modifier-plus-key",
  "tap-only",
]);
export type HoldSupport = z.infer<typeof HoldSupportSchema>;

export const ChordSourceCapabilitiesSchema = z.object({
  backend: z.enum(["gnome", "kde", "hyprland", "other"]),
  /** A shortcutDeactivated also arrives when any other key is released. */
  releaseOnAnyKeyUp: z.boolean(),
  /** The user must add the binding in the compositor configuration. */
  needsManualBind: z.boolean(),
  /** shortcutsBound carries the trigger text that the compositor shows. */
  reportsBoundTrigger: z.boolean(),
  /** The helper sends a new shortcutsBound when the user rebinds in system settings. */
  emitsShortcutsChanged: z.boolean(),
});
export type ChordSourceCapabilities = z.infer<
  typeof ChordSourceCapabilitiesSchema
>;

export const EvdevStatusSchema = z.object({
  available: z.boolean(),
  reason: z
    .enum(["no-permission", "no-devices", "not-built", "disabled"])
    .optional(),
});
export type EvdevStatus = z.infer<typeof EvdevStatusSchema>;

export const InjectionBackendSchema = z.enum([
  "xtest",
  "portal-remote-desktop",
  "wl-virtual-keyboard",
  "uinput",
]);
export type InjectionBackend = z.infer<typeof InjectionBackendSchema>;

export const ClipboardBackendSchema = z.enum([
  "x11",
  "portal-clipboard",
  "wl-data-control",
  "wl-copy",
]);
export type ClipboardBackend = z.infer<typeof ClipboardBackendSchema>;

export const GetHelperCapabilitiesResultSchema = z.object({
  keyInputMode: KeyInputModeSchema,
  keyInputBackend: KeyInputBackendSchema.nullable().default(null),
  /** "any" for per-key backends; "tap-only" when keyInputMode is "none". */
  holdSupport: HoldSupportSchema,
  /** Set only when keyInputMode is "chord". */
  chord: ChordSourceCapabilitiesSchema.nullable().default(null),
  evdev: EvdevStatusSchema,
  /** Who stops shortcut keys from reaching the focused app. */
  chordConsume: z.enum(["helper", "compositor", "none"]),
  injectionAvailable: z.boolean(),
  injectionBackend: InjectionBackendSchema.nullable().default(null),
  /** State of the user consent that the injection backend needs. */
  injectionConsent: z.enum(["granted", "required", "denied", "none"]),
  clipboardBackend: ClipboardBackendSchema.nullable().default(null),
  /** Setting the clipboard moves keyboard focus away from the target app. */
  clipboardStealsFocus: z.boolean(),
  accessibilityContextAvailable: z.boolean(),
  ambianceAvailable: z.boolean(),
  sessionType: z.enum(["x11", "wayland", "unknown"]),
  /** XDG_CURRENT_DESKTOP as the helper read it. */
  desktop: z.string().nullable().default(null),
  helperVersion: z.string().optional(),
  /** Human-readable note for logs and the settings page. */
  message: z.string().optional(),
});
export type GetHelperCapabilitiesResult = z.infer<
  typeof GetHelperCapabilitiesResultSchema
>;
