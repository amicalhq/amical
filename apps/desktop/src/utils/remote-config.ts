import {
  type RemoteConfig,
  type RemoteConfigContent,
  type RemoteConfigIconName,
  type RemoteConfigSurface,
  type RemoteConfigTone,
} from "@/types/remote-config";
import {
  APP_NAV_ITEMS,
  SETTINGS_NAV_ITEMS,
} from "@/renderer/main/lib/settings-navigation";

const ALLOWED_CTA_DOMAIN = "amical.ai";

// Internal app routes an `open_route` CTA may target — derived from the nav tree
// so it stays in sync as routes are added/removed. Config is untrusted, so an
// unknown route is dropped rather than handed to the router.
const ALLOWED_CTA_ROUTES: ReadonlySet<string> = new Set(
  [...APP_NAV_ITEMS, ...SETTINGS_NAV_ITEMS].map((item) => item.url),
);

// Default lucide glyph per tone — used when a surface names no `icon`/`iconUrl`,
// and as the renderer's fallback when a named icon isn't a real lucide icon.
export const TONE_DEFAULT_ICON: Record<RemoteConfigTone, RemoteConfigIconName> =
  {
    default: "sparkles",
    info: "info",
    warning: "triangle-alert",
    success: "check",
  };

// Server-side targeting decides who/when; the client only re-checks `expiresAt`
// so a surface that ages out of a cached payload disappears on time. Validation
// upstream guarantees a well-formed ISO timestamp, so a NaN here means tampered
// data — fail closed (hide).
export function isRemoteConfigSurfaceActive(
  surface: RemoteConfigSurface,
  now: Date = new Date(),
): boolean {
  if (!surface.expiresAt) {
    return true;
  }

  const expiresAt = Date.parse(surface.expiresAt);
  return !Number.isNaN(expiresAt) && expiresAt > now.getTime();
}

// A surface is dismissed only until its stored reshow window (computed from
// `reshowAfterDays` at dismiss time) elapses.
function isSurfaceDismissed(
  surface: RemoteConfigSurface,
  dismissedUntil: Record<string, number>,
  now: Date,
): boolean {
  const until = dismissedUntil[surface.id];
  return until != null && now.getTime() < until;
}

export function getActiveRemoteConfigSurfaces(
  config: RemoteConfig,
  dismissedUntil: Record<string, number> = {},
  now: Date = new Date(),
): RemoteConfigSurface[] {
  return (config.surfaces ?? [])
    .filter(
      (surface) =>
        !isSurfaceDismissed(surface, dismissedUntil, now) &&
        isRemoteConfigSurfaceActive(surface, now),
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export type ResolvedSurfaceIcon =
  | { kind: "url"; url: string }
  | { kind: "name"; name: RemoteConfigIconName };

// Decides what the icon tile renders. A valid `iconUrl` (https + amical.ai) wins;
// otherwise the named lucide icon; otherwise the tone's default glyph. Config is
// untrusted, so a non-allowlisted iconUrl is ignored (never inlined); the named
// icon is passed through and the renderer falls back to the tone default if it
// isn't a real lucide icon.
export function resolveSurfaceIcon(
  content: RemoteConfigContent,
  tone: RemoteConfigTone = "default",
): ResolvedSurfaceIcon {
  if (content.iconUrl && isSafeRemoteConfigUrl(content.iconUrl)) {
    return { kind: "url", url: content.iconUrl };
  }

  if (content.icon) {
    return { kind: "name", name: content.icon };
  }

  return { kind: "name", name: TONE_DEFAULT_ICON[tone] };
}

export function isSafeRemoteConfigUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (hostname === ALLOWED_CTA_DOMAIN ||
        hostname.endsWith(`.${ALLOWED_CTA_DOMAIN}`)) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function isSafeRemoteConfigRoute(route: string): boolean {
  return ALLOWED_CTA_ROUTES.has(route);
}
