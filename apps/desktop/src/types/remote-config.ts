import {
  RemoteConfigResponseSchema,
  type RemoteConfigSurface,
} from "@amical/api-contracts/apps/v1";
import { z } from "zod";

export { RemoteConfigSurfaceSchema } from "@amical/api-contracts/apps/v1";
export type {
  UpdateRequirement,
  RemoteConfigSurface,
  RemoteConfigContent,
  RemoteConfigCta,
} from "@amical/api-contracts/apps/v1";

// Every domain is optional and `version` is open, so a response or a cached
// payload without a domain still parses.
export const RemoteConfigSchema = RemoteConfigResponseSchema.partial({
  surfaces: true,
  flags: true,
}).extend({ version: z.number() });
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;

export type RemoteConfigBannerSurface = RemoteConfigSurface & {
  kind: "banner";
};
export type RemoteConfigSideSlotSurface = RemoteConfigSurface & {
  kind: "side_slot";
};
export type RemoteConfigTone = NonNullable<RemoteConfigSurface["tone"]>;

// Any lucide-react icon name, kebab-case (e.g. "sparkles", "triangle-alert").
// The client resolves the name to a bundled lucide glyph and falls back to the
// tone's default glyph if it isn't a real icon.
export type RemoteConfigIconName = string;

export const DESKTOP_STAR_NUDGE_FLAG = "desktop-star-nudge";

// Reshow window when a surface omits `reshowAfterDays`.
export const DEFAULT_RESHOW_AFTER_DAYS = 30;
