import { z } from 'zod';

// Request params
export const GetAccessibilityContextParamsSchema = z.object({
  editableOnly: z.boolean().optional().default(true), // Only return text selection if element is editable
});
export type GetAccessibilityContextParams = z.infer<
  typeof GetAccessibilityContextParamsSchema
>;

// Data structures for the result
const SelectionRangeSchema = z.object({
  location: z.number().int(),
  length: z.number().int(),
});

const ApplicationInfoSchema = z.object({
  name: z.string().nullable(),
  bundleIdentifier: z.string().nullable(),
  version: z.string().nullable(),
});

const FocusedElementInfoSchema = z.object({
  role: z.string().nullable(), // Main accessibility role (e.g., "AXTextField", "AXButton")
  isEditable: z.boolean(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  value: z.string().nullable(),
});

const TextSelectionInfoSchema = z.object({
  selectedText: z.string(),
  fullContent: z.string().nullable(),
  preSelectionText: z.string().nullable(),
  postSelectionText: z.string().nullable(),
  selectionRange: SelectionRangeSchema.nullable(),
  isEditable: z.boolean(),
});

const WindowInfoSchema = z.object({
  title: z.string().nullable(),
  url: z.string().nullable(), // Browser URL if available
});

const AccessibilityContextSchema = z.object({
  application: ApplicationInfoSchema,
  focusedElement: FocusedElementInfoSchema.nullable(),
  textSelection: TextSelectionInfoSchema.nullable(),
  windowInfo: WindowInfoSchema.nullable(),
  timestamp: z.number(),
});

// Response result
export const GetAccessibilityContextResultSchema = z.object({
  context: AccessibilityContextSchema.nullable(),
});
export type GetAccessibilityContextResult = z.infer<
  typeof GetAccessibilityContextResultSchema
>;

// Export individual schemas for potential reuse
export type ApplicationInfo = z.infer<typeof ApplicationInfoSchema>;
export type FocusedElementInfo = z.infer<typeof FocusedElementInfoSchema>;
export type TextSelectionInfo = z.infer<typeof TextSelectionInfoSchema>;
export type WindowInfo = z.infer<typeof WindowInfoSchema>;
export type AccessibilityContext = z.infer<typeof AccessibilityContextSchema>;
export type SelectionRange = z.infer<typeof SelectionRangeSchema>;