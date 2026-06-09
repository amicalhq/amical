import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Download,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/trpc/react";
import { useTranslation } from "react-i18next";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useUpdateState } from "@/hooks/useUpdateState";
import type { UpdateState } from "@/main/services/auto-updater";

const routeApi = getRouteApi("/_app/settings/about");

const CHANGELOG_URL = "https://github.com/amicalhq/amical/releases";
const GITHUB_URL = "https://github.com/amicalhq/amical";
const DISCORD_URL = "https://amical.ai/community";
const CONTACT_EMAIL = "contact@amical.ai";

const UPDATE_STATUS: Record<
  UpdateState,
  {
    Icon: LucideIcon;
    iconClassName: string;
    textClassName?: string;
    labelKey: string;
  }
> = {
  checking: {
    Icon: RefreshCw,
    iconClassName: "w-3.5 h-3.5 animate-spin",
    labelKey: "settings.about.update.checking",
  },
  available: {
    Icon: Download,
    iconClassName: "w-3.5 h-3.5 animate-pulse",
    labelKey: "settings.about.update.downloading",
  },
  downloaded: {
    Icon: CheckCircle2,
    iconClassName: "w-3.5 h-3.5",
    textClassName: "text-foreground",
    labelKey: "settings.about.update.ready",
  },
  error: {
    Icon: AlertCircle,
    iconClassName: "w-3.5 h-3.5",
    textClassName: "text-destructive",
    labelKey: "settings.about.update.error",
  },
  "not-available": {
    Icon: CheckCircle2,
    iconClassName: "w-3.5 h-3.5",
    labelKey: "settings.about.update.upToDate",
  },
};

export default function AboutSettingsPage() {
  const { t } = useTranslation();
  const { data: version } = api.settings.getAppVersion.useQuery();
  const updateCardRef = React.useRef<HTMLDivElement>(null);
  const highlightTimeoutRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [isUpdateCardHighlighted, setIsUpdateCardHighlighted] =
    React.useState(false);
  const updateState = useUpdateState();
  const navigate = useNavigate();
  const { focusUpdate } = routeApi.useSearch();

  const checkForUpdates = api.updater.checkForUpdates.useMutation();
  const quitAndInstall = api.updater.quitAndInstall.useMutation();
  const isReady = updateState === "downloaded";

  const buttonBusy =
    updateState === "checking" ||
    updateState === "available" ||
    checkForUpdates.isPending ||
    quitAndInstall.isPending;

  function handleUpdateClick() {
    if (isReady) {
      quitAndInstall.mutate();
      return;
    }

    checkForUpdates.mutate({ userInitiated: true });
  }

  const focusUpdateCard = React.useCallback(() => {
    const card = updateCardRef.current;
    if (!card) return;

    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.focus({ preventScroll: true });
    setIsUpdateCardHighlighted(true);

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setIsUpdateCardHighlighted(false);
      highlightTimeoutRef.current = null;
    }, 1600);
  }, []);

  React.useEffect(() => {
    if (!focusUpdate) return;
    focusUpdateCard();
    // Clear the flag so a repeat click on the sidebar CTA re-triggers focus.
    navigate({ to: "/settings/about", search: {}, replace: true });
  }, [focusUpdate, focusUpdateCard, navigate]);

  React.useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  function renderStatus() {
    const { Icon, iconClassName, textClassName, labelKey } =
      UPDATE_STATUS[updateState];
    return (
      <span className={cn("flex items-center gap-1.5", textClassName)}>
        <Icon className={iconClassName} />
        {t(labelKey)}
      </span>
    );
  }

  return (
    <div>
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.about.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.about.description")}
        </p>
      </div>

      <div className="space-y-6">
        <Card
          ref={updateCardRef}
          tabIndex={-1}
          className={cn(
            "outline-none transition-[border-color,box-shadow] duration-300",
            isUpdateCardHighlighted &&
            "border-indigo-500 ring-2 ring-indigo-500/50",
          )}
        >
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Left: version identity */}
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                {t("settings.about.currentVersion")}
              </div>
              <div className="text-xl font-semibold tabular-nums text-foreground">
                v{version || "..."}
              </div>
            </div>

            {/* Right: action + co-located status */}
            <div className="flex w-full flex-col items-stretch gap-2 md:w-auto md:items-end">
              <Button
                variant={isReady ? "default" : "outline"}
                className="flex w-full items-center justify-center gap-2 md:w-auto"
                onClick={handleUpdateClick}
                disabled={buttonBusy}
              >
                <RefreshCw
                  className={cn("w-4 h-4", buttonBusy && "animate-spin")}
                />
                {isReady
                  ? t("settings.about.update.restartButton")
                  : t("settings.about.update.checkButton")}
              </Button>
              <div
                role="status"
                aria-live="polite"
                className="min-h-5 text-xs text-muted-foreground md:text-right"
              >
                {renderStatus()}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-foreground">
                {t("settings.about.resources.title")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.about.resources.description")}
              </p>
            </div>
            <div className="divide-y">
              <ExternalLink href={CHANGELOG_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      <BookOpen className="w-5 h-5 text-muted-foreground" />
                      {t("settings.about.resources.changeLog.title")}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.about.resources.changeLog.description")}
                    </div>
                  </div>
                </div>
              </ExternalLink>
              <ExternalLink href={GITHUB_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      {/* GitHub icon as image */}
                      <img
                        src="icons/integrations/github.svg"
                        alt={t("settings.about.resources.github.alt")}
                        className="w-5 h-5 inline-block align-middle"
                      />
                      {t("settings.about.resources.github.title")}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.about.resources.github.description")}
                    </div>
                  </div>
                </div>
              </ExternalLink>
              <ExternalLink href={DISCORD_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      {/* Discord icon as image */}
                      <img
                        src="icons/integrations/discord.svg"
                        alt={t("settings.about.resources.discord.alt")}
                        className="w-5 h-5 inline-block align-middle"
                      />
                      {t("settings.about.resources.discord.title")}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("settings.about.resources.discord.description")}
                    </div>
                  </div>
                </div>
              </ExternalLink>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-foreground">
                {t("settings.about.contact.title")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.about.contact.description")}
              </p>
            </div>
            <ExternalLink href={`mailto:${CONTACT_EMAIL}`}>
              <div className="flex items-center justify-between group cursor-pointer">
                <div>
                  <div className="font-semibold text-base group-hover:underline">
                    {CONTACT_EMAIL}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t("settings.about.contact.emailCta")}
                  </div>
                </div>
              </div>
            </ExternalLink>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const ExternalLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => {
  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(href);
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick(e as any);
        }
      }}
      style={{ cursor: "pointer" }}
    >
      {children}
    </a>
  );
};
