import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ExternalLink,
  icons,
  type LucideIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import type {
  RemoteConfig,
  RemoteConfigBannerSurface,
  RemoteConfigContent,
  RemoteConfigCta,
  RemoteConfigSideSlotSurface,
  RemoteConfigSurface,
  RemoteConfigTone,
} from "@/types/remote-config";
import {
  getActiveRemoteConfigSurfaces,
  isSafeRemoteConfigRoute,
  isSafeRemoteConfigUrl,
  resolveSurfaceIcon,
  TONE_DEFAULT_ICON,
} from "@/utils/remote-config";
import {
  DISMISSED_CHANGED_EVENT,
  readDismissedUntil,
  recordDismissal,
} from "@/utils/remote-config-dismissals";

// Resolve a kebab-case lucide name (any of the ~1700 icons) to its component;
// undefined if the name isn't a real icon. Custom art comes through `iconUrl`
// instead and is rendered as an <img>.
function lucideGlyph(name: string): LucideIcon | undefined {
  const pascal = name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return (icons as Record<string, LucideIcon | undefined>)[pascal];
}

// Tone → accent classes. The payload carries only the semantic tone; all colour
// lives here (via the brand/info/warn/success tokens in globals.css). `solid` =
// filled accent; `soft` = tinted outline. Text on a filled accent uses the
// tone's `-foreground` token.
type ToneStyle = {
  surface: string;
  tile: string;
  eyebrow: string;
  solid: string;
  soft: string;
};
const TONE_STYLES: Record<RemoteConfigTone, ToneStyle> = {
  default: {
    surface: "border-brand/20 from-brand/[0.07]",
    tile: "bg-brand text-brand-foreground",
    eyebrow: "text-brand",
    solid: "bg-brand text-brand-foreground hover:bg-brand/90",
    soft: "border-brand/30 bg-brand/[0.07] text-brand hover:bg-brand/15 hover:text-brand",
  },
  info: {
    surface: "border-info/20 from-info/[0.07]",
    tile: "bg-info text-info-foreground",
    eyebrow: "text-info",
    solid: "bg-info text-info-foreground hover:bg-info/90",
    soft: "border-info/30 bg-info/[0.07] text-info hover:bg-info/15 hover:text-info",
  },
  warning: {
    surface: "border-warn/20 from-warn/[0.07]",
    tile: "bg-warn text-warn-foreground",
    eyebrow: "text-warn",
    solid: "bg-warn text-warn-foreground hover:bg-warn/90",
    soft: "border-warn/30 bg-warn/[0.07] text-warn hover:bg-warn/15 hover:text-warn",
  },
  success: {
    surface: "border-success/20 from-success/[0.07]",
    tile: "bg-success text-success-foreground",
    eyebrow: "text-success",
    solid: "bg-success text-success-foreground hover:bg-success/90",
    soft: "border-success/30 bg-success/[0.07] text-success hover:bg-success/15 hover:text-success",
  },
};

function toneOf(surface: RemoteConfigSurface): RemoteConfigTone {
  return surface.tone ?? "default";
}

// Dismissals are local + per-device (store lives in remote-config-dismissals).
// Re-read on the in-renderer change event and the cross-window "storage" event.
function useDismissals() {
  const [dismissedUntil, setDismissedUntil] =
    React.useState(readDismissedUntil);

  React.useEffect(() => {
    const sync = () => setDismissedUntil(readDismissedUntil());
    window.addEventListener(DISMISSED_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DISMISSED_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { dismissedUntil, dismiss: recordDismissal };
}

const EMPTY_REMOTE_CONFIG: RemoteConfig = { version: 1, surfaces: [] };

// Server-controlled config from amical-core (the main-process RemoteConfigService).
function useRemoteConfig(): RemoteConfig {
  const live = api.remoteConfig.get.useQuery();
  return live.data ?? EMPTY_REMOTE_CONFIG;
}

// Host of the web app — CTAs pointing here are opened via the signed-in session
// handoff so the user lands authenticated instead of on a login wall.
const WEB_APP_HOST = "app.amical.ai";

// Runs a CTA's navigation/external action. `dismiss` is handled by the caller
// (it needs the surface id), so it is a no-op here.
function useRemoteConfigCtaHandler() {
  const navigate = useNavigate();
  const authStatus = api.auth.getAuthStatus.useQuery();
  const openWebSession = api.auth.openWebSession.useMutation();
  const isAuthenticated = authStatus.data?.isAuthenticated ?? false;

  return React.useCallback(
    async (cta: RemoteConfigCta) => {
      if (cta.action === "open_route") {
        if (!isSafeRemoteConfigRoute(cta.route)) {
          window.electronAPI.log.warn(
            "Blocked remote config CTA route",
            cta.route,
          );
          return;
        }
        navigate({ to: cta.route });
        return;
      }

      if (cta.action === "open_external_url") {
        if (!isSafeRemoteConfigUrl(cta.url)) {
          window.electronAPI.log.warn("Blocked remote config CTA URL", cta.url);
          return;
        }

        // The URL passed isSafeRemoteConfigUrl, so it parses (https, amical.ai).
        const target = new URL(cta.url);

        // For the web app, hand off the desktop session so the user arrives
        // already signed in. Anonymous users — or any non-app host — just open
        // the URL directly.
        if (isAuthenticated && target.hostname === WEB_APP_HOST) {
          try {
            await openWebSession.mutateAsync({
              returnPath: target.pathname + target.search + target.hash,
            });
            return;
          } catch (error) {
            // Handoff failed (e.g. expired token) — fall back to a plain open.
            window.electronAPI.log.warn(
              "Web-session handoff failed, opening directly",
              error,
            );
          }
        }

        await window.electronAPI.openExternal(cta.url);
      }
    },
    [navigate, isAuthenticated, openWebSession],
  );
}

function SurfaceDismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      aria-label="Dismiss"
    >
      <X className="size-3.5" />
    </Button>
  );
}

// Indigo/tone icon tile that anchors each surface. Renders a bundled glyph, or a
// remote image when the surface supplied a safe `iconUrl` (rendered as an
// <img>, never inlined, so SVG scripts can't execute).
function SurfaceIcon({
  content,
  tone,
  tileClassName,
  glyphClassName,
}: {
  content: RemoteConfigContent;
  tone: RemoteConfigTone;
  tileClassName?: string;
  glyphClassName?: string;
}) {
  const icon = resolveSurfaceIcon(content, tone);

  let glyph: React.ReactNode;
  if (icon.kind === "url") {
    glyph = (
      <img
        src={icon.url}
        alt=""
        className={cn("object-contain", glyphClassName)}
      />
    );
  } else {
    // Unknown name → the tone's default glyph → Sparkles (the tone defaults are
    // always real lucide icons, so the final fallback never actually fires).
    const Glyph =
      lucideGlyph(icon.name) ??
      lucideGlyph(TONE_DEFAULT_ICON[tone]) ??
      icons.Sparkles;
    glyph = <Glyph className={glyphClassName} />;
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[10px] shadow-xs",
        TONE_STYLES[tone].tile,
        tileClassName,
      )}
    >
      {glyph}
    </span>
  );
}

function SurfaceText({
  surface,
  compact = false,
}: {
  surface: RemoteConfigBannerSurface | RemoteConfigSideSlotSurface;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      {surface.content.eyebrow ? (
        <div
          className={cn(
            "mb-1 text-[10px] font-semibold uppercase tracking-wider",
            TONE_STYLES[toneOf(surface)].eyebrow,
          )}
        >
          {surface.content.eyebrow}
        </div>
      ) : null}
      {surface.content.title ? (
        <div
          className={cn(
            "font-semibold leading-snug tracking-[-0.01em] text-foreground",
            compact ? "text-[13px]" : "text-sm",
          )}
        >
          {surface.content.title}
        </div>
      ) : null}
      <p
        className={cn(
          "leading-relaxed text-muted-foreground",
          compact ? "mt-1 text-xs" : "mt-1 text-[13px]",
        )}
      >
        {surface.content.body}
      </p>
    </div>
  );
}

function SurfaceCta({
  cta,
  tone,
  intent,
  fullWidth = false,
  onAct,
}: {
  cta: RemoteConfigCta;
  tone: RemoteConfigTone;
  intent: "solid" | "soft";
  fullWidth?: boolean;
  onAct: (cta: RemoteConfigCta) => void;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <Button
      type="button"
      size="sm"
      variant={intent === "soft" ? "outline" : "default"}
      className={cn(
        "h-7 gap-1.5 px-2.5 text-xs font-medium",
        fullWidth && "h-8 w-full justify-center font-semibold",
        intent === "soft" ? styles.soft : styles.solid,
      )}
      onClick={() => onAct(cta)}
    >
      <span>{cta.label}</span>
      {cta.action === "open_external_url" ? (
        <ExternalLink className="size-3.5" />
      ) : null}
      {cta.action === "open_route" ? (
        <ArrowRight className="size-3.5 opacity-80" />
      ) : null}
    </Button>
  );
}

// Optional banner background image: only an allowlisted https amical.ai URL is
// honoured, rendered as an <img> behind a card-tinted scrim that keeps the copy
// legible.
function SurfaceBackdrop({ url }: { url?: string }) {
  if (!url || !isSafeRemoteConfigUrl(url)) {
    return null;
  }
  return (
    <>
      <img
        src={url}
        alt=""
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-card via-card/85 to-card/40" />
    </>
  );
}

function RemoteConfigBanner({
  surface,
  onDismiss,
  onCta,
}: {
  surface: RemoteConfigBannerSurface;
  onDismiss: (id: string, reshowAfterDays?: number) => void;
  onCta: (cta: RemoteConfigCta) => void;
}) {
  const tone = toneOf(surface);
  const act = (cta: RemoteConfigCta) =>
    cta.action === "dismiss"
      ? onDismiss(surface.id, surface.reshowAfterDays)
      : onCta(cta);

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border bg-gradient-to-b to-card px-3.5 py-3 shadow-sm",
        TONE_STYLES[tone].surface,
      )}
    >
      <SurfaceBackdrop url={surface.content.backgroundImageUrl} />
      <div className="relative flex items-start gap-3">
        <SurfaceIcon
          content={surface.content}
          tone={tone}
          tileClassName="size-9"
          glyphClassName="size-[18px]"
        />
        <div className="min-w-0 flex-1">
          <SurfaceText surface={surface} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {surface.secondaryCta ? (
            <SurfaceCta
              cta={surface.secondaryCta}
              tone={tone}
              intent="soft"
              onAct={act}
            />
          ) : null}
          {surface.cta ? (
            <SurfaceCta
              cta={surface.cta}
              tone={tone}
              intent="solid"
              onAct={act}
            />
          ) : null}
          {surface.dismissible ? (
            <SurfaceDismissButton
              onClick={() => onDismiss(surface.id, surface.reshowAfterDays)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function RemoteConfigSideSlot({
  surface,
  onDismiss,
  onCta,
}: {
  surface: RemoteConfigSideSlotSurface;
  onDismiss: (id: string, reshowAfterDays?: number) => void;
  onCta: (cta: RemoteConfigCta) => void;
}) {
  const tone = toneOf(surface);
  const act = (cta: RemoteConfigCta) =>
    cta.action === "dismiss"
      ? onDismiss(surface.id, surface.reshowAfterDays)
      : onCta(cta);

  return (
    <div
      className={cn(
        "relative mx-2 overflow-hidden rounded-xl border bg-gradient-to-b to-card p-3 shadow-sm",
        TONE_STYLES[tone].surface,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <SurfaceIcon
          content={surface.content}
          tone={tone}
          tileClassName="size-7"
          glyphClassName="size-[15px]"
        />
        {surface.dismissible ? (
          <SurfaceDismissButton
            onClick={() => onDismiss(surface.id, surface.reshowAfterDays)}
          />
        ) : null}
      </div>
      <div className="mt-2.5">
        <SurfaceText surface={surface} compact />
      </div>
      {surface.cta || surface.secondaryCta ? (
        <div className="mt-3 grid gap-2">
          {[surface.cta, surface.secondaryCta]
            .filter((c): c is RemoteConfigCta => Boolean(c))
            .map((c) => (
              <SurfaceCta
                key={c.label}
                cta={c}
                tone={tone}
                intent="soft"
                fullWidth
                onAct={act}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

// Shared derivation for both surface mount points: the live active surfaces plus
// the dismiss/CTA handlers. Each consumer picks the one surface kind it renders.
// (The two components mount at different points in the tree, so they call this
// independently rather than sharing one element.)
function useActiveRemoteConfigSurfaces() {
  const config = useRemoteConfig();
  const { dismissedUntil, dismiss } = useDismissals();
  const handleCta = useRemoteConfigCtaHandler();

  const surfaces = React.useMemo(
    () => getActiveRemoteConfigSurfaces(config, dismissedUntil),
    [config, dismissedUntil],
  );

  return { surfaces, dismiss, handleCta };
}

export function RemoteConfigSurfaces({
  children,
}: {
  children: React.ReactNode;
}) {
  const { surfaces, dismiss, handleCta } = useActiveRemoteConfigSurfaces();

  const banner = surfaces.find(
    (surface): surface is RemoteConfigBannerSurface =>
      surface.kind === "banner",
  );

  return (
    <>
      {banner ? (
        <RemoteConfigBanner
          surface={banner}
          onDismiss={dismiss}
          onCta={handleCta}
        />
      ) : null}
      {children}
    </>
  );
}

export function RemoteConfigSidebarSlot() {
  const { surfaces, dismiss, handleCta } = useActiveRemoteConfigSurfaces();

  const sideSlot = surfaces.find(
    (surface): surface is RemoteConfigSideSlotSurface =>
      surface.kind === "side_slot",
  );

  if (!sideSlot) {
    return null;
  }

  return (
    <RemoteConfigSideSlot
      surface={sideSlot}
      onDismiss={dismiss}
      onCta={handleCta}
    />
  );
}
