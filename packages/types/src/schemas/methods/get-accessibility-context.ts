import { z } from "zod";

// =============================================================================
// Accessibility Context Schema
// =============================================================================
// Schema for the Swift helper accessibility layer.
// Key features:
// - TextMarker API support for Electron/Chromium apps
// - Extraction method tracking for debugging
// - Performance metrics
// - Secure field and placeholder detection
// - UTF-16 code unit semantics (documented)
// =============================================================================

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

/**
 * How the text selection was extracted.
 * Priority order: textMarkerRange > selectedTextRange > selectedTextRanges > valueAttribute > stringForRange
 */
export const ExtractionMethodSchema = z.enum([
  "textMarkerRange", // Primary - AXSelectedTextMarkerRange (works in Electron)
  "selectedTextRange", // Fallback 1 - AXSelectedTextRange
  "selectedTextRanges", // Fallback 2 - AXSelectedTextRanges (multi-select)
  "valueAttribute", // Fallback 3 - AXValue
  "stringForRange", // Fallback 4 - AXStringForRange
  "clipboardCopy", // Fallback 5 - Clipboard (Phase 2)
  "none", // No extraction possible (secure field, etc.)
]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

// -----------------------------------------------------------------------------
// Core Data Structures
// -----------------------------------------------------------------------------

/**
 * Character range for text selection.
 *
 * IMPORTANT: UTF-16 Code Unit Semantics
 * All `location` and `length` values are UTF-16 code unit offsets (equivalent to NSString indices),
 * NOT Unicode scalar or grapheme cluster counts.
 *
 * This matches macOS Accessibility API semantics where CFRange and NSRange use UTF-16 code units.
 * Characters outside the Basic Multilingual Plane (e.g., emoji like 👨‍👩‍👧‍👦) occupy 2 code units (surrogate pair).
 *
 * Examples:
 * - "a" (U+0061) = 1 code unit
 * - "😀" (U+1F600) = 2 code units
 * - "👨‍👩‍👧‍👦" = 11 code units (multiple emoji + ZWJ)
 *
 * Implications:
 * - Swift: Use String.utf16 view for slicing
 * - TypeScript/JS: string.length counts code units, so indices align correctly
 */
export const SelectionRangeSchema = z.object({
  /** UTF-16 code unit offset from start (NOT grapheme count) */
  location: z.number().int().nonnegative(),
  /** UTF-16 code unit count (0 = cursor only, no selection) */
  length: z.number().int().nonnegative(),
});
export type SelectionRange = z.infer<typeof SelectionRangeSchema>;

/**
 * Text selection information.
 *
 * Null vs Empty String Semantics:
 * - null = unavailable/unknown (API failed, attribute doesn't exist, or suppressed for security)
 * - "" = available and empty (API succeeded, value exists, but is legitimately empty)
 *
 * Examples:
 * - Cursor-only: selectedText = "" (not null), selectionRange.length = 0
 * - Empty text field: fullContent = "" (not null)
 * - Secure field: all text fields are null (suppressed)
 */
export const TextSelectionSchema = z.object({
  // Core data
  /** Selected text ("" for cursor-only, null if unavailable/suppressed) */
  selectedText: z.string().nullable(),
  /** Full textbox content (window around selection if large, null if unavailable) */
  fullContent: z.string().nullable(),
  /** Up to 500 UTF-16 units before selection (null if unavailable) */
  preSelectionText: z.string().nullable(),
  /** Up to 500 UTF-16 units after selection (null if unavailable) */
  postSelectionText: z.string().nullable(),
  /** UTF-16 code unit range (null for secure fields or if unavailable) */
  selectionRange: SelectionRangeSchema.nullable(),

  // Metadata
  /** Can user type in this element? */
  isEditable: z.boolean(),
  /** How was selection obtained? */
  extractionMethod: ExtractionMethodSchema,
  /** Multi-cursor/selection detected? */
  hasMultipleRanges: z.boolean(),

  // Safety flags
  /** Is this showing placeholder text only (no user input)? */
  isPlaceholder: z.boolean(),
  /** Is this a password/secure field? (all content fields will be null) */
  isSecure: z.boolean(),

  // Truncation info
  /** Was fullContent truncated/windowed due to size limits? */
  fullContentTruncated: z.boolean(),
});
export type TextSelection = z.infer<typeof TextSelectionSchema>;

/**
 * Focused element information.
 */
export const AXElementInfoSchema = z.object({
  /** AXRole (AXTextField, AXWebArea, etc.) */
  role: z.string().nullable(),
  /** AXSubrole if present */
  subrole: z.string().nullable(),
  /** AXTitle */
  title: z.string().nullable(),
  /** AXDescription */
  description: z.string().nullable(),
  /** AXValue (null for secure fields - suppressed for security) */
  value: z.string().nullable(),
  /** Can user type in this element? */
  isEditable: z.boolean(),
  /** Is this element focused? */
  isFocused: z.boolean(),
  /** Is this a secure/password field? */
  isSecure: z.boolean(),
  /** Is this showing placeholder text? */
  isPlaceholder: z.boolean(),
});
export type AXElementInfo = z.infer<typeof AXElementInfoSchema>;

/**
 * Application information.
 */
export const ApplicationInfoSchema = z.object({
  /** Application name */
  name: z.string().nullable(),
  /** Bundle identifier (e.g., com.apple.Safari) */
  bundleIdentifier: z.string().nullable(),
  /** Application version */
  version: z.string().nullable(),
  /** Process ID */
  pid: z.number().int(),
});
export type ApplicationInfo = z.infer<typeof ApplicationInfoSchema>;

/**
 * Window information.
 */
export const WindowInfoSchema = z.object({
  /** Window title */
  title: z.string().nullable(),
  /** Browser URL if detected */
  url: z.string().nullable(),
});
export type WindowInfo = z.infer<typeof WindowInfoSchema>;

/**
 * Extraction performance metrics.
 *
 * Note: Error strings must contain only technical error messages, never PII or content values.
 * Allowed: "TextMarker: AXError -25204", "Timeout exceeded"
 * Forbidden: "Failed to parse text: Hello World", "Value was: password123"
 */
export const ExtractionMetricsSchema = z.object({
  /** Total extraction time in milliseconds */
  totalTimeMs: z.number().nonnegative(),
  /** Did we attempt TextMarker extraction? */
  textMarkerAttempted: z.boolean(),
  /** Did TextMarker extraction succeed? */
  textMarkerSucceeded: z.boolean(),
  /** Which fallback methods were tried (in order) */
  fallbacksUsed: z.array(ExtractionMethodSchema),
  /** Technical error messages only - NO PII/content */
  errors: z.array(z.string()),
  /** Did extraction exceed best-effort time budget? */
  timedOut: z.boolean(),

  // WebArea retry path metrics
  /** Did we search for WebArea candidates? (true when TextMarker fails on focused element) */
  webAreaRetryAttempted: z.boolean(),
  /** Did we find a different WebArea to switch to? */
  webAreaFound: z.boolean(),
  /** Did TextMarker work on the switched WebArea? */
  webAreaRetrySucceeded: z.boolean(),
});
export type ExtractionMetrics = z.infer<typeof ExtractionMetricsSchema>;

// -----------------------------------------------------------------------------
// Main Response Schema
// -----------------------------------------------------------------------------

/**
 * Complete accessibility context response.
 */
export const AppContextSchema = z.object({
  /** Schema version for future evolution */
  schemaVersion: z.literal("2.0"),

  // Application context
  /** Information about the frontmost application */
  application: ApplicationInfoSchema,
  /** Window information (may be null) */
  windowInfo: WindowInfoSchema.nullable(),

  // Focus and selection
  /** Currently focused element (may be null if no focus) */
  focusedElement: AXElementInfoSchema.nullable(),
  /** Text selection information (may be null if no text field focused) */
  textSelection: TextSelectionSchema.nullable(),

  // Timing
  /** Unix timestamp in seconds when context was captured */
  timestamp: z.number(),

  // Debugging
  /** Performance metrics for this extraction */
  metrics: ExtractionMetricsSchema,
});
export type AppContext = z.infer<typeof AppContextSchema>;

// -----------------------------------------------------------------------------
// RPC Method Schemas
// -----------------------------------------------------------------------------

/**
 * Request params for getAccessibilityContext
 */
export const GetAccessibilityContextParamsSchema = z.object({
  /**
   * Only return text selection if element is editable.
   * When true: searches for nearest editable element if current focus is not editable.
   * When false: returns whatever element is focused, editable or not.
   * Default: false
   */
  editableOnly: z.boolean().optional().default(false),
});
export type GetAccessibilityContextParams = z.infer<
  typeof GetAccessibilityContextParamsSchema
>;

/**
 * Response result for getAccessibilityContext
 */
export const GetAccessibilityContextResultSchema = z.object({
  context: AppContextSchema.nullable(),
});
export type GetAccessibilityContextResult = z.infer<
  typeof GetAccessibilityContextResultSchema
>;

/**
 * Request params for getAccessibilityStatus
 */
export const GetAccessibilityStatusParamsSchema = z.object({});
export type GetAccessibilityStatusParams = z.infer<
  typeof GetAccessibilityStatusParamsSchema
>;

/**
 * Response result for getAccessibilityStatus
 */
export const GetAccessibilityStatusResultSchema = z.object({
  /** Does the app have accessibility permission? */
  hasPermission: z.boolean(),
  /** Is accessibility enabled system-wide? */
  isEnabled: z.boolean(),
});
export type GetAccessibilityStatusResult = z.infer<
  typeof GetAccessibilityStatusResultSchema
>;

/**
 * Request params for requestAccessibilityPermission
 */
export const RequestAccessibilityPermissionParamsSchema = z.object({});
export type RequestAccessibilityPermissionParams = z.infer<
  typeof RequestAccessibilityPermissionParamsSchema
>;

/**
 * Response result for requestAccessibilityPermission
 */
export const RequestAccessibilityPermissionResultSchema = z.object({
  /** Was permission granted? */
  granted: z.boolean(),
});
export type RequestAccessibilityPermissionResult = z.infer<
  typeof RequestAccessibilityPermissionResultSchema
>;

// -----------------------------------------------------------------------------
// Constants (for reference - actual values defined in Swift)
// -----------------------------------------------------------------------------

/**
 * Context extraction limits (UTF-16 code units).
 * These are documented here for reference; actual enforcement is in Swift.
 */
export const ACCESSIBILITY_CONSTANTS = {
  /** Max UTF-16 units for pre/post selection context */
  MAX_CONTEXT_LENGTH: 500,
  /** Max UTF-16 units for fullContent window */
  MAX_FULL_CONTENT_LENGTH: 50000,
  /** UTF-16 units of padding around selection for windowing */
  WINDOW_PADDING: 25000,
  /** Best-effort timeout target in milliseconds */
  BEST_EFFORT_TIMEOUT_MS: 600,
  /** Max depth for element tree search */
  TREE_WALK_MAX_DEPTH: 8,
  /** Max elements to search in tree walk */
  TREE_WALK_MAX_ELEMENTS: 100,
} as const;
