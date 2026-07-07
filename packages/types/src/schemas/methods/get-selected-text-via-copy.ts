import { z } from "zod";

// =============================================================================
// getSelectedTextViaCopy - Clipboard-based selection capture (last resort)
// =============================================================================
// Captures the current selection in the frontmost app by simulating the
// platform copy chord (Cmd+C on macOS, Ctrl+Insert on Windows) with full
// clipboard save/restore around it. Intended as a fallback for when the
// accessibility APIs cannot read the selection (textSelection.selectedText
// is null); callers decide when it is safe/worth it to invoke (e.g. draft
// mode only). Injecting a copy chord has side effects (clipboard managers
// observe the transient copy, some apps beep) — do not call it routinely.
// =============================================================================

// Request params
export const GetSelectedTextViaCopyParamsSchema = z.object({});
export type GetSelectedTextViaCopyParams = z.infer<
  typeof GetSelectedTextViaCopyParamsSchema
>;

// Response result
export const GetSelectedTextViaCopyResultSchema = z.object({
  /**
   * Captured selection text.
   * - string: the app responded to the copy chord with text
   * - null: nothing captured — no selection, the app ignored the chord, or
   *   the copy produced no text (e.g. an image selection). Indistinguishable
   *   by design; check clipboardChanged to tell "app copied something
   *   non-text" from "nothing happened".
   */
  selectedText: z.string().nullable().default(null),
  /** Did the clipboard change in response to the injected copy chord? */
  clipboardChanged: z.boolean(),
  /** Optional diagnostic message (e.g. clipboard restore failure) */
  message: z.string().optional(),
});
export type GetSelectedTextViaCopyResult = z.infer<
  typeof GetSelectedTextViaCopyResultSchema
>;
