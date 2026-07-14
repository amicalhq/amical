import { z } from "zod";

// Remote config — server-controlled UI/config delivered from amical-core (Axis).
//
// The payload is a VERSIONED, NAMESPACED envelope: `surfaces` is one domain;
// other server-controlled config domains slot in alongside it later, each
// independently optional and independently validated so a malformed domain can
// never break another (partial application, fail-closed per domain).
//
// Targeting is server-side: Axis returns only the surfaces a client should
// currently see (audience + enable + schedule already applied), so there are no
// targeting rules in this contract. The client keeps `expiresAt` only, as a
// safety-net to hide a surface that ages out of a cached payload between fetches.
//
// This schema is the single source of truth; desktop/native/www all conform,
// and the package's generators emit JSON-Schema/Swift/C# from it.

// Any lucide-react icon name, kebab-case (e.g. "sparkles", "triangle-alert").
// The client resolves the name to a bundled lucide glyph and falls back to the
// tone's default glyph if it isn't a real icon; for zero-deploy custom art a
// surface uses `iconUrl` instead.
export type RemoteConfigIconName = string;

// Semantic accent. Omitted ⇒ "default" (indigo). The CLIENT owns the
// tone→colour/default-icon mapping — the payload never carries styling.
export const RemoteConfigToneSchema = z.enum([
  "default",
  "info",
  "warning",
  "success",
]);
export type RemoteConfigTone = z.infer<typeof RemoteConfigToneSchema>;

export const RemoteConfigContentSchema = z.object({
  body: z.string(),
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  // `icon` names any lucide glyph (kebab-case); `iconUrl` is a remote image
  // rendered as an <img> (never inlined). `iconUrl` wins when both are present.
  // Client also enforces the https + amical.ai allowlist on the URL fields below.
  icon: z.string().optional(),
  iconUrl: z.string().url().optional(),
  backgroundImageUrl: z.string().url().optional(),
});
export type RemoteConfigContent = z.infer<typeof RemoteConfigContentSchema>;

export const RemoteConfigCtaSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open_external_url"),
    label: z.string(),
    url: z.string().url(),
  }),
  z.object({
    action: z.literal("open_route"),
    label: z.string(),
    route: z.string(),
  }),
  z.object({ action: z.literal("dismiss"), label: z.string() }),
]);
export type RemoteConfigCta = z.infer<typeof RemoteConfigCtaSchema>;

// Default reshow window when a surface omits `reshowAfterDays`. Lives in the
// contract so every client (desktop/native/www) lapses dismissals the same way.
export const DEFAULT_RESHOW_AFTER_DAYS = 30;

// Shared fields, kept as a raw shape so each `kind` can extend it inside a
// discriminated union.
const surfaceBase = {
  id: z.string(), // stable; rotate on meaningful content change (dismissal key)
  dismissible: z.boolean().optional(), // default false
  reshowAfterDays: z.number().optional(), // dismissal lapses after N days (default DEFAULT_RESHOW_AFTER_DAYS)
  priority: z.number().optional(), // default 0; highest of a kind wins
  expiresAt: z.string().datetime().optional(), // ISO-8601 UTC; client safety-net
  tone: RemoteConfigToneSchema.optional(),
  content: RemoteConfigContentSchema,
  cta: RemoteConfigCtaSchema.optional(),
  secondaryCta: RemoteConfigCtaSchema.optional(),
};

export const RemoteConfigSurfaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("banner"), ...surfaceBase }), // always top-anchored
  z.object({ kind: z.literal("side_slot"), ...surfaceBase }),
]);
export type RemoteConfigSurface = z.infer<typeof RemoteConfigSurfaceSchema>;
export type RemoteConfigBannerSurface = Extract<
  RemoteConfigSurface,
  { kind: "banner" }
>;
export type RemoteConfigSideSlotSurface = Extract<
  RemoteConfigSurface,
  { kind: "side_slot" }
>;

export const RemoteConfigSchema = z.object({
  version: z.number(),
  surfaces: z.array(RemoteConfigSurfaceSchema).optional(),
  flags: z.record(z.string(), z.boolean()).optional(),
});
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;
