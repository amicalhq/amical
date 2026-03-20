import { z } from "zod";

import { isInternalUrl } from "@/utils/url";

export const NOTE_WINDOW_FEATURE_FLAG = "note-window";
export const SIDEBAR_CTA_FEATURE_FLAG = "sidebar-cta";

export const SidebarCtaPaletteSchema = z.enum(["purple", "green"]);
export type SidebarCtaPalette = z.infer<typeof SidebarCtaPaletteSchema>;

export const SidebarCtaStyleSchema = z.enum([
  "solid",
  "text",
  "shimmer",
  "border",
]);
export type SidebarCtaStyle = z.infer<typeof SidebarCtaStyleSchema>;

const SidebarCtaPayloadSchema = z.object({
  text: z.string().trim().min(1),
  url: z.string().trim().min(1),
  palette: SidebarCtaPaletteSchema.optional(),
  style: SidebarCtaStyleSchema.optional(),
  emoji: z.string().trim().min(1).optional(),
});

export type SidebarCtaPayload = z.infer<typeof SidebarCtaPayloadSchema>;

export function isFeatureFlagEnabled(
  value: string | boolean | undefined,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return !["false", "0", "off", "disabled"].includes(normalized);
}

export function parseSidebarCtaPayload(
  payload: unknown,
): SidebarCtaPayload | null {
  const parsed = SidebarCtaPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const data = parsed.data;

  if (isInternalUrl(data.url)) {
    return data;
  }

  try {
    const url = new URL(data.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return {
      ...data,
      url: url.toString(),
    };
  } catch {
    return null;
  }
}
